import type { Config } from "./config.js";
import { ToolError } from "./keycloak/errors.js";
import type { KeycloakGateway } from "./keycloak/gateway.js";

export type RealmPolicy = Pick<Config, "allowedRealms" | "allowMasterWrite">;

/**
 * Control characters, unpaired surrogates and invisible characters (zero-width,
 * bidi controls, variation selectors, ...). Keycloak may ignore the invisible
 * ones when it looks a name up, so they would hide which object is meant.
 */
const UNSAFE_CHARS = /[\p{Cc}\p{Cs}\p{Default_Ignorable_Code_Point}]/u;

/**
 * Validates a value that ends up as a URL path segment (realm name, user id, ...).
 * Rejects separators, dot segments, control and invisible characters and
 * leading or trailing whitespace. Other Unicode (e.g. accented names) is fine.
 */
export function assertPathSegment(value: string, label = "value"): void {
  if (
    value.length === 0 ||
    value.length > 255 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.trim() !== value ||
    UNSAFE_CHARS.test(value)
  ) {
    throw new ToolError(
      "guard",
      `Invalid ${label}: must be non-empty and must not contain '/', '\\', '..', control or invisible characters, or leading or trailing whitespace.`,
    );
  }
}

const isMasterName = (realm: string) => realm.toLowerCase() === "master";

function masterWriteDisabled(): ToolError {
  return new ToolError(
    "guard",
    "Write operations in the 'master' realm are disabled. Set KEYCLOAK_MCP_ALLOW_MASTER_WRITE=true to allow them.",
  );
}

/**
 * Checks the realm name as given against the allowlist and the master write
 * protection. Writes additionally go through resolveWriteRealm(), which checks
 * the realm Keycloak actually resolves the name to.
 */
export function assertRealmAllowed(
  policy: RealmPolicy,
  realm: string,
  options: { write: boolean },
): void {
  assertPathSegment(realm, "realm");
  if (policy.allowedRealms.length > 0 && !policy.allowedRealms.includes(realm)) {
    throw new ToolError(
      "guard",
      `Realm '${realm}' is not permitted by KEYCLOAK_MCP_REALMS (allowed: ${policy.allowedRealms.join(", ")}).`,
    );
  }
  if (options.write && isMasterName(realm) && !policy.allowMasterWrite) {
    throw masterWriteDisabled();
  }
}

export function isRealmAllowed(policy: RealmPolicy, realm: string): boolean {
  return policy.allowedRealms.length === 0 || policy.allowedRealms.includes(realm);
}

// ---------------------------------------------------------------------------
// Realm resolution for writes
// ---------------------------------------------------------------------------

export interface ResolvedRealm {
  /** The realm name as Keycloak stores it. */
  name: string;
  /** Internal id; missing when the account may only see the realm's name. */
  id?: string;
}

/** How long a resolved realm is reused before Keycloak is asked again. */
export const REALM_CACHE_TTL_MS = 60_000;
const REALM_CACHE_MAX = 100;

interface CacheEntry {
  value: ResolvedRealm | undefined;
  expiresAt: number;
}

/** One cache per gateway (that is, per Keycloak connection). */
const caches = new WeakMap<KeycloakGateway, Map<string, CacheEntry>>();

async function lookupRealm(
  gateway: KeycloakGateway,
  name: string,
  now: number,
  options: { tolerateErrors: boolean },
): Promise<ResolvedRealm | undefined> {
  let cache = caches.get(gateway);
  if (cache === undefined) {
    cache = new Map();
    caches.set(gateway, cache);
  }
  const hit = cache.get(name);
  if (hit !== undefined && hit.expiresAt > now) return hit.value;
  let value: ResolvedRealm | undefined;
  try {
    const rep = await gateway.run((kc) => kc.realms.findOne({ realm: name }));
    if (typeof rep?.realm === "string") {
      value = { name: rep.realm, ...(typeof rep.id === "string" && { id: rep.id }) };
    }
  } catch (error) {
    if (!options.tolerateErrors) throw error;
  }
  // Unknown names are only cached for the error-tolerant master lookup.
  if (value !== undefined || options.tolerateErrors) {
    if (cache.size >= REALM_CACHE_MAX) cache.clear();
    cache.set(name, { value, expiresAt: now + REALM_CACHE_TTL_MS });
  }
  return value;
}

/**
 * Resolves the realm of a write through Keycloak and applies the allowlist and
 * the master write protection to the realm Keycloak actually uses, compared by
 * its stored name and, where visible, by its id. Depending on the database
 * collation, Keycloak may resolve a differently spelled name to an existing
 * realm. Returns the stored name, which the write must use from then on.
 */
export async function resolveWriteRealm(
  ctx: { config: RealmPolicy; gateway: KeycloakGateway },
  realm: string,
  now: number = Date.now(),
): Promise<ResolvedRealm> {
  assertRealmAllowed(ctx.config, realm, { write: true });
  const resolved = await lookupRealm(ctx.gateway, realm, now, { tolerateErrors: false });
  if (resolved === undefined) {
    throw new ToolError("not_found", `Realm '${realm}' does not exist. Nothing was changed.`);
  }
  if (resolved.name !== realm) {
    assertRealmAllowed(ctx.config, resolved.name, { write: true });
  }
  if (!ctx.config.allowMasterWrite && resolved.id !== undefined) {
    // Accounts without access to master cannot see its id; their writes there fail anyway.
    const master = await lookupRealm(ctx.gateway, "master", now, { tolerateErrors: true });
    if (master?.id === resolved.id) throw masterWriteDisabled();
  }
  return resolved;
}

/**
 * Destructive and sensitive tools must be called with confirm=true when
 * confirmation is required. `unconditional` confirmations (administrative grants,
 * the server's own account) ignore KEYCLOAK_MCP_REQUIRE_CONFIRMATION=false.
 * Throws a ToolError carrying the preview so the model can ask the user and retry.
 */
export function requireConfirmation(
  policy: Pick<Config, "requireConfirmation">,
  confirm: boolean | undefined,
  preview: string,
  options: { unconditional?: boolean } = {},
): void {
  if (confirm === true) return;
  if (!policy.requireConfirmation && options.unconditional !== true) return;
  const always = options.unconditional === true ? " This confirmation cannot be turned off." : "";
  throw new ToolError(
    "confirmation_required",
    `Confirmation required. This would: ${preview} Nothing was changed. Ask the user for approval, then call this tool again with confirm: true.${always}`,
  );
}
