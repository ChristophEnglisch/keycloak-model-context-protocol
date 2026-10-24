import type { Config } from "./config.js";
import { ToolError } from "./keycloak/errors.js";

export type RealmPolicy = Pick<Config, "allowedRealms" | "allowMasterWrite">;

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validates a value that ends up as a URL path segment (realm name, user id, ...).
 * Rejects separators, dot segments and control characters.
 */
export function assertPathSegment(value: string, label = "value"): void {
  if (
    value.length === 0 ||
    value.length > 255 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    hasControlChars(value)
  ) {
    throw new ToolError(
      "guard",
      `Invalid ${label}: must be non-empty and must not contain '/', '\\', '..' or control characters.`,
    );
  }
}

/** Checks the realm against the allowlist and the master write protection. */
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
  if (options.write && realm.toLowerCase() === "master" && !policy.allowMasterWrite) {
    throw new ToolError(
      "guard",
      "Write operations in the 'master' realm are disabled. Set KEYCLOAK_MCP_ALLOW_MASTER_WRITE=true to allow them.",
    );
  }
}

export function isRealmAllowed(policy: RealmPolicy, realm: string): boolean {
  return policy.allowedRealms.length === 0 || policy.allowedRealms.includes(realm);
}

/**
 * Destructive tools must be called with confirm=true when confirmation is required.
 * Throws a ToolError carrying the preview so the model can ask the user and retry.
 */
export function requireConfirmation(
  policy: Pick<Config, "requireConfirmation">,
  confirm: boolean | undefined,
  preview: string,
): void {
  if (!policy.requireConfirmation || confirm === true) return;
  throw new ToolError(
    "confirmation_required",
    `Confirmation required. This would: ${preview} Nothing was changed. Ask the user for approval, then call this tool again with confirm: true.`,
  );
}
