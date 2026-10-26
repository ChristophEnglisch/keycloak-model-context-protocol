import { isIP } from "node:net";
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
/** Unset or blank means "not configured"; a value without any entry (e.g. ",") is an error. */
const commaList = z.preprocess(
  blankToUndefined,
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return [];
      const items = value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (items.length === 0) {
        ctx.issues.push({
          code: "custom",
          input: value,
          message: "contains no entries; leave it unset or name at least one entry",
        });
      }
      return items;
    }),
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

/** Every environment variable this server reads. */
export const KNOWN_VARIABLES: readonly string[] = Object.keys(EnvSchema.shape);

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The known variable closest to `name`, if it is close enough to be a likely typo. */
export function suggestVariable(name: string): string | undefined {
  // Compare without prefix and underscores too, so KEYCLOAK_READONLY finds KEYCLOAK_MCP_READ_ONLY.
  const core = (v: string) => v.replace(/^KEYCLOAK_(MCP_)?/, "").replaceAll("_", "");
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const given = core(name);
  for (const known of KNOWN_VARIABLES) {
    const target = core(known);
    // A shortened or extended name (KEYCLOAK_MCP_REQUIRE_CONFIRM) counts as close.
    const prefix = given.length >= 4 && (target.startsWith(given) || given.startsWith(target));
    const distance = prefix ? 1 : Math.min(editDistance(name, known), editDistance(given, target));
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  const limit = Math.min(3, Math.max(1, Math.floor(given.length / 3)));
  return bestDistance <= limit ? best : undefined;
}

/** Warnings for KEYCLOAK_* variables this server does not know (only names, never values). */
function unknownVariableWarnings(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((name) => name.startsWith("KEYCLOAK_") && !KNOWN_VARIABLES.includes(name))
    .sort()
    .map((name) => {
      const suggestion = suggestVariable(name);
      return suggestion === undefined
        ? `Unknown variable ${name} is ignored; it is not a setting of this server.`
        : `Unknown variable ${name} is ignored; did you mean ${suggestion}?`;
    });
}

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
  const warnings: string[] = unknownVariableWarnings(env);

  const { protocol, hostname, username: urlUser, password: urlPassword } = new URL(e.KEYCLOAK_URL);
  if (urlUser !== "" || urlPassword !== "") {
    // Never echo the URL: it contains the credentials.
    issues.push(
      "KEYCLOAK_URL: must not contain a user name or password (user:password@host). Use KEYCLOAK_CLIENT_ID/KEYCLOAK_CLIENT_SECRET or KEYCLOAK_USERNAME/KEYCLOAK_PASSWORD.",
    );
  }

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

/**
 * True for `localhost`, `*.localhost` and the loopback addresses 127.0.0.0/8 and
 * ::1. Addresses are parsed, so host names that merely start with "127." do not count.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  switch (isIP(host)) {
    case 4:
      return host.split(".")[0] === "127";
    case 6:
      return host === "::1";
    default:
      return false;
  }
}

/** Values that must be masked in logs. */
export function collectSecrets(config: Pick<Config, "credentials">): string[] {
  const { credentials } = config;
  const secrets: string[] = [];
  if (credentials.clientSecret) secrets.push(credentials.clientSecret);
  if (credentials.grantType === "password") secrets.push(credentials.password);
  return secrets;
}
