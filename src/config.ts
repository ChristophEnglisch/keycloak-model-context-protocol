import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./logging.js";

export const TOOLSET_NAMES = [
  "core",
  "groups",
  "roles",
  "clients",
  "sessions",
  "events",
  "security",
] as const;
export type ToolsetName = (typeof TOOLSET_NAMES)[number];

export const DEFAULT_TOOLSETS: readonly ToolsetName[] = ["core", "groups", "roles"];

export type Credentials =
  | { grantType: "client_credentials"; clientId: string; clientSecret: string }
  | {
      grantType: "password";
      clientId: string;
      clientSecret?: string;
      username: string;
      password: string;
    };

export interface Config {
  url: string;
  authRealm: string;
  credentials: Credentials;
  readOnly: boolean;
  /** Empty means: every realm is allowed. */
  allowedRealms: readonly string[];
  allowMasterWrite: boolean;
  toolsets: ReadonlySet<ToolsetName>;
  requireConfirmation: boolean;
  timeoutMs: number;
  logLevel: LogLevel;
  /** Non-fatal notices (e.g. deprecated variables) for the caller to log. */
  warnings: readonly string[];
}

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const flag = (fallback: boolean) =>
  z.preprocess(blankToUndefined, z.stringbool().default(fallback));
const commaList = z.preprocess(
  blankToUndefined,
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
);

const EnvSchema = z.object({
  KEYCLOAK_URL: z.preprocess(
    blankToUndefined,
    z
      .string({ error: "is required (base URL of the Keycloak server)" })
      .pipe(z.url({ protocol: /^https?$/, error: "must be a valid http(s) URL" })),
  ),
  KEYCLOAK_AUTH_REALM: z.preprocess(blankToUndefined, z.string().default("master")),
  KEYCLOAK_CLIENT_ID: optionalString,
  KEYCLOAK_CLIENT_SECRET: optionalString,
  KEYCLOAK_USERNAME: optionalString,
  KEYCLOAK_PASSWORD: optionalString,
  KEYCLOAK_ADMIN: optionalString,
  KEYCLOAK_ADMIN_PASSWORD: optionalString,
  KEYCLOAK_GRANT_TYPE: z.preprocess(
    blankToUndefined,
    z
      .enum(["client_credentials", "password"], {
        error: "must be 'client_credentials' or 'password'",
      })
      .optional(),
  ),
  KEYCLOAK_MCP_READ_ONLY: flag(false),
  KEYCLOAK_MCP_REALMS: commaList,
  KEYCLOAK_MCP_ALLOW_MASTER_WRITE: flag(false),
  KEYCLOAK_MCP_TOOLSETS: commaList,
  KEYCLOAK_MCP_REQUIRE_CONFIRMATION: flag(true),
  KEYCLOAK_MCP_TIMEOUT_MS: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: "must be a number of milliseconds" })
      .int({ error: "must be an integer" })
      .min(1, { error: "must be at least 1" })
      .default(30_000),
  ),
  KEYCLOAK_MCP_LOG_LEVEL: z.preprocess(
    blankToUndefined,
    z.enum(LOG_LEVELS, { error: `must be one of: ${LOG_LEVELS.join(", ")}` }).default("info"),
  ),
});

function resolveToolsets(names: readonly string[], issues: string[]): Set<ToolsetName> {
  if (names.length === 0) return new Set(DEFAULT_TOOLSETS);
  if (names.includes("all")) return new Set(TOOLSET_NAMES);
  const result = new Set<ToolsetName>();
  for (const name of names) {
    if ((TOOLSET_NAMES as readonly string[]).includes(name)) {
      result.add(name as ToolsetName);
    } else {
      issues.push(
        `KEYCLOAK_MCP_TOOLSETS: unknown toolset '${name}' (valid: ${TOOLSET_NAMES.join(", ")}, all)`,
      );
    }
  }
  return result;
}

/**
 * Parses and validates the environment. There are deliberately no credential
 * defaults: missing or contradictory settings fail fast with a ConfigError.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`),
    );
  }
  const e = parsed.data;
  const issues: string[] = [];
  const warnings: string[] = [];

  const username = e.KEYCLOAK_USERNAME ?? e.KEYCLOAK_ADMIN;
  const password = e.KEYCLOAK_PASSWORD ?? e.KEYCLOAK_ADMIN_PASSWORD;
  if (e.KEYCLOAK_ADMIN !== undefined && e.KEYCLOAK_USERNAME === undefined) {
    warnings.push("KEYCLOAK_ADMIN is deprecated; use KEYCLOAK_USERNAME instead.");
  }
  if (e.KEYCLOAK_ADMIN_PASSWORD !== undefined && e.KEYCLOAK_PASSWORD === undefined) {
    warnings.push("KEYCLOAK_ADMIN_PASSWORD is deprecated; use KEYCLOAK_PASSWORD instead.");
  }

  const grantType =
    e.KEYCLOAK_GRANT_TYPE ??
    (e.KEYCLOAK_CLIENT_SECRET !== undefined
      ? "client_credentials"
      : username !== undefined
        ? "password"
        : undefined);

  let credentials: Credentials | undefined;
  if (grantType === undefined) {
    issues.push(
      "No credentials configured: set KEYCLOAK_CLIENT_ID + KEYCLOAK_CLIENT_SECRET (client_credentials) or KEYCLOAK_USERNAME + KEYCLOAK_PASSWORD (password).",
    );
  } else if (grantType === "client_credentials") {
    if (e.KEYCLOAK_CLIENT_ID === undefined) {
      issues.push("KEYCLOAK_CLIENT_ID: is required for the client_credentials grant");
    }
    if (e.KEYCLOAK_CLIENT_SECRET === undefined) {
      issues.push("KEYCLOAK_CLIENT_SECRET: is required for the client_credentials grant");
    }
    if (e.KEYCLOAK_CLIENT_ID !== undefined && e.KEYCLOAK_CLIENT_SECRET !== undefined) {
      credentials = {
        grantType,
        clientId: e.KEYCLOAK_CLIENT_ID,
        clientSecret: e.KEYCLOAK_CLIENT_SECRET,
      };
    }
  } else {
    if (username === undefined)
      issues.push("KEYCLOAK_USERNAME: is required for the password grant");
    if (password === undefined)
      issues.push("KEYCLOAK_PASSWORD: is required for the password grant");
    if (username !== undefined && password !== undefined) {
      credentials = {
        grantType,
        clientId: e.KEYCLOAK_CLIENT_ID ?? "admin-cli",
        ...(e.KEYCLOAK_CLIENT_SECRET !== undefined && { clientSecret: e.KEYCLOAK_CLIENT_SECRET }),
        username,
        password,
      };
    }
  }

  const toolsets = resolveToolsets(e.KEYCLOAK_MCP_TOOLSETS, issues);

  if (issues.length > 0 || credentials === undefined) {
    throw new ConfigError(issues);
  }

  const { protocol, hostname } = new URL(e.KEYCLOAK_URL);
  if (protocol === "http:" && !isLoopbackHost(hostname)) {
    warnings.push(
      `KEYCLOAK_URL uses plain http:// for the remote host '${hostname}'; tokens and credentials travel unencrypted. Use https://.`,
    );
  }

  return {
    url: e.KEYCLOAK_URL.replace(/\/+$/, ""),
    authRealm: e.KEYCLOAK_AUTH_REALM,
    credentials,
    readOnly: e.KEYCLOAK_MCP_READ_ONLY,
    allowedRealms: e.KEYCLOAK_MCP_REALMS,
    allowMasterWrite: e.KEYCLOAK_MCP_ALLOW_MASTER_WRITE,
    toolsets,
    requireConfirmation: e.KEYCLOAK_MCP_REQUIRE_CONFIRMATION,
    timeoutMs: e.KEYCLOAK_MCP_TIMEOUT_MS,
    logLevel: e.KEYCLOAK_MCP_LOG_LEVEL,
    warnings,
  };
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

/** Values that must be masked in logs. */
export function collectSecrets(config: Pick<Config, "credentials">): string[] {
  const { credentials } = config;
  const secrets: string[] = [];
  if (credentials.clientSecret) secrets.push(credentials.clientSecret);
  if (credentials.grantType === "password") secrets.push(credentials.password);
  return secrets;
}
