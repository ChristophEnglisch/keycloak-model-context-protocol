import KcAdminClient, { NetworkError } from "@keycloak/keycloak-admin-client";
import type { Config } from "../config.js";
import { type Logger, silentLogger } from "../logging.js";
import { type ErrorContext, httpStatusOf, mapKeycloakError, ToolError } from "./errors.js";

/** The only way tools talk to Keycloak. Tests replace it with a fake. */
export interface KeycloakGateway {
  /**
   * Runs `fn` with an authenticated admin client. The target realm must always
   * be passed explicitly in the request payload (e.g. `kc.users.find({ realm })`).
   */
  run<T>(fn: (kc: KcAdminClient) => Promise<T>): Promise<T>;
}

export type GatewayConfig = Pick<Config, "url" | "authRealm" | "credentials" | "timeoutMs">;

export interface GatewayOptions {
  /** Inject a client (tests). Defaults to a real KcAdminClient bound to the auth realm. */
  client?: KcAdminClient;
  now?: () => number;
  logger?: Logger;
  /** Refresh this long before the access token expires. */
  refreshSkewMs?: number;
  /** Used for the logout on close() (tests). */
  fetch?: typeof fetch;
}

const DEFAULT_SKEW_MS = 30_000;
const FALLBACK_LIFETIME_MS = 60_000;
/** Wait after a rejected login; doubles with every further rejection up to the maximum. */
export const LOGIN_BACKOFF_INITIAL_MS = 30_000;
export const LOGIN_BACKOFF_MAX_MS = 10 * 60_000;
/** close() gives up on the logout after this long, so shutdown is never blocked. */
export const LOGOUT_TIMEOUT_MS = 2_000;

function tokenClaims(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return decoded !== null && typeof decoded === "object"
      ? (decoded as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function tokenExpiryMs(token: string | undefined): number | undefined {
  const exp = tokenClaims(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : undefined;
}

/** True for a token of the master realm that carries the realm role `admin` (a superuser). */
export function isMasterSuperuserToken(token: string | undefined): boolean {
  const claims = tokenClaims(token);
  const realmAccess = claims?.realm_access as { roles?: unknown } | undefined;
  return (
    typeof claims?.iss === "string" &&
    claims.iss.endsWith("/realms/master") &&
    Array.isArray(realmAccess?.roles) &&
    realmAccess.roles.includes("admin")
  );
}

/**
 * Keycloak answers a password login of a user locked by brute force detection
 * exactly like a wrong password, so the message has to mention both.
 */
function passwordLoginHint(error: unknown, realm: string): string | undefined {
  if (!(error instanceof NetworkError)) return undefined;
  const data = error.responseData as { error_description?: unknown } | undefined;
  const description = typeof data?.error_description === "string" ? data.error_description : "";
  if (/disabled/i.test(description)) {
    return `The account is disabled in realm '${realm}'. Brute force detection with permanent lockout also disables accounts; an administrator has to enable it again.`;
  }
  if (error.response.status === 400 || error.response.status === 401) {
    return `If the password is correct, the account may be locked by brute force detection in realm '${realm}': Keycloak reports a locked account like a wrong password. An administrator can check and clear the lockout in the admin console (Users > the user > Brute force detection).`;
  }
  return undefined;
}

/**
 * Owns the admin client and the token lifecycle. The client's realm is the
 * auth realm for its whole life; target realms travel only in request payloads
 * (never via setConfig), so tokens can never be requested from a target realm.
 */
export class KeycloakAdminGateway implements KeycloakGateway {
  private readonly kc: KcAdminClient;
  private readonly config: GatewayConfig;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly skewMs: number;
  private readonly fetch: typeof fetch;
  private expiresAtMs = 0;
  private inflight: Promise<void> | undefined;
  /** Set after a rejected login: no new attempt before `notBeforeMs`. */
  private loginBlock: { error: ToolError; notBeforeMs: number; waitMs: number } | undefined;
  private superuserChecked = false;

  constructor(config: GatewayConfig, options: GatewayOptions = {}) {
    this.config = config;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? silentLogger;
    this.skewMs = options.refreshSkewMs ?? DEFAULT_SKEW_MS;
    this.fetch = options.fetch ?? fetch;
    this.kc =
      options.client ??
      new KcAdminClient({
        baseUrl: config.url,
        realmName: config.authRealm,
        timeout: config.timeoutMs,
      });
  }

  private get errorContext(): ErrorContext {
    return {
      baseUrl: this.config.url,
      authRealm: this.config.authRealm,
      timeoutMs: this.config.timeoutMs,
    };
  }

  async run<T>(fn: (kc: KcAdminClient) => Promise<T>): Promise<T> {
    await this.ensureToken();
    try {
      return await fn(this.kc);
    } catch (error) {
      if (httpStatusOf(error) !== 401) throw mapKeycloakError(error, this.errorContext);
      // Token revoked or expired server-side: re-authenticate once and retry.
      this.logger.debug("Keycloak returned 401; re-authenticating once");
      this.expiresAtMs = 0;
      await this.ensureToken();
      try {
        return await fn(this.kc);
      } catch (retryError) {
        throw mapKeycloakError(retryError, this.errorContext);
      }
    }
  }

  private tokenIsFresh(): boolean {
    return this.kc.accessToken !== undefined && this.now() < this.expiresAtMs - this.skewMs;
  }

  /** Single-flight: concurrent callers share one login/refresh. */
  private async ensureToken(): Promise<void> {
    if (this.tokenIsFresh()) return;
    this.inflight ??= this.authenticate().finally(() => {
      this.inflight = undefined;
    });
    await this.inflight;
  }

  private async authenticate(): Promise<void> {
    const { credentials } = this.config;
    const block = this.loginBlock;
    if (block !== undefined && this.now() < block.notBeforeMs) {
      const seconds = Math.ceil((block.notBeforeMs - this.now()) / 1000);
      throw new ToolError(
        block.error.kind,
        `${block.error.message} No new login attempt for ${seconds} s: after a rejected login the server waits before trying again, so that brute force detection does not lock the account. Restart the server after fixing the configuration.`,
        block.error.status,
      );
    }
    try {
      // Only the password grant gets a refresh token; client_credentials always logs in again.
      if (credentials.grantType === "password" && this.kc.refreshToken && this.kc.accessToken) {
        try {
          await this.kc.auth({
            grantType: "refresh_token",
            clientId: credentials.clientId,
            ...(credentials.clientSecret !== undefined && {
              clientSecret: credentials.clientSecret,
            }),
            refreshToken: this.kc.refreshToken,
          });
          this.recordExpiry();
          return;
        } catch {
          this.logger.debug("Token refresh failed; falling back to full login");
        }
      }
      await this.kc.auth(
        credentials.grantType === "client_credentials"
          ? {
              grantType: "client_credentials",
              clientId: credentials.clientId,
              clientSecret: credentials.clientSecret,
            }
          : {
              grantType: "password",
              clientId: credentials.clientId,
              ...(credentials.clientSecret !== undefined && {
                clientSecret: credentials.clientSecret,
              }),
              username: credentials.username,
              password: credentials.password,
            },
      );
      this.recordExpiry();
      this.loginBlock = undefined;
      this.warnIfSuperuser();
    } catch (error) {
      this.expiresAtMs = 0;
      const mapped = mapKeycloakError(error, { ...this.errorContext, phase: "login" });
      if (mapped.kind !== "auth") throw mapped;
      // Rejected credentials: wait before the next attempt instead of retrying on every call.
      const waitMs = Math.min(
        block === undefined ? LOGIN_BACKOFF_INITIAL_MS : block.waitMs * 2,
        LOGIN_BACKOFF_MAX_MS,
      );
      const hint =
        credentials.grantType === "password"
          ? passwordLoginHint(error, this.config.authRealm)
          : undefined;
      const failure = new ToolError(
        "auth",
        hint === undefined ? mapped.message : `${mapped.message} ${hint}`,
        mapped.status,
      );
      this.loginBlock = { error: failure, notBeforeMs: this.now() + waitMs, waitMs };
      this.logger.warn("Keycloak rejected the login; pausing login attempts", {
        retryInSeconds: Math.ceil(waitMs / 1000),
      });
      throw new ToolError(
        "auth",
        `${failure.message} The next login attempt is allowed in ${Math.ceil(waitMs / 1000)} s.`,
        failure.status,
      );
    }
  }

  /** Warns once if the password grant signs in as a superuser of the master realm. */
  private warnIfSuperuser(): void {
    if (this.superuserChecked || this.config.credentials.grantType !== "password") return;
    this.superuserChecked = true;
    if (isMasterSuperuserToken(this.kc.accessToken)) {
      this.logger.warn(
        "Signed in with the password grant as a superuser of the master realm (realm role 'admin'): this server can change every realm. Prefer a service account (client_credentials) with only the realm-management roles it needs.",
      );
    }
  }

  /**
   * Ends the Keycloak session of the password grant (client_credentials creates
   * none). Never throws and gives up after LOGOUT_TIMEOUT_MS.
   */
  async close(): Promise<void> {
    const { credentials } = this.config;
    if (credentials.grantType !== "password") return;
    await this.inflight?.catch(() => undefined);
    const refreshToken = this.kc.refreshToken;
    if (!refreshToken) return;
    try {
      const response = await this.fetch(
        `${this.config.url}/realms/${encodeURIComponent(this.config.authRealm)}/protocol/openid-connect/logout`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: credentials.clientId,
            ...(credentials.clientSecret !== undefined && {
              client_secret: credentials.clientSecret,
            }),
            refresh_token: refreshToken,
          }),
          signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
        },
      );
      await response.arrayBuffer().catch(() => undefined);
      if (response.ok) this.logger.debug("Ended the Keycloak session of the password grant");
      else this.logger.debug("Logout from Keycloak failed", { status: response.status });
    } catch (error) {
      this.logger.debug("Logout from Keycloak failed", {
        error: error instanceof Error ? error.name : String(error),
      });
    } finally {
      this.kc.refreshToken = undefined;
      this.kc.accessToken = undefined;
      this.expiresAtMs = 0;
    }
  }

  private recordExpiry(): void {
    this.expiresAtMs = tokenExpiryMs(this.kc.accessToken) ?? this.now() + FALLBACK_LIFETIME_MS;
  }
}
