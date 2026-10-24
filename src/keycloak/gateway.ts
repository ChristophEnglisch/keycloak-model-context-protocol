import KcAdminClient from "@keycloak/keycloak-admin-client";
import type { Config } from "../config.js";
import { type Logger, silentLogger } from "../logging.js";
import { type ErrorContext, httpStatusOf, mapKeycloakError } from "./errors.js";

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
}

const DEFAULT_SKEW_MS = 30_000;
const FALLBACK_LIFETIME_MS = 60_000;

function tokenExpiryMs(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
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
  private expiresAtMs = 0;
  private inflight: Promise<void> | undefined;

  constructor(config: GatewayConfig, options: GatewayOptions = {}) {
    this.config = config;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? silentLogger;
    this.skewMs = options.refreshSkewMs ?? DEFAULT_SKEW_MS;
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
    try {
      if (this.kc.refreshToken && this.kc.accessToken) {
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
    } catch (error) {
      this.expiresAtMs = 0;
      throw mapKeycloakError(error, { ...this.errorContext, phase: "login" });
    }
  }

  private recordExpiry(): void {
    this.expiresAtMs = tokenExpiryMs(this.kc.accessToken) ?? this.now() + FALLBACK_LIFETIME_MS;
  }
}
