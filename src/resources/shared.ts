import type { ReadResourceResult } from "@modelcontextprotocol/server";
import { assertPathSegment, assertRealmAllowed } from "../guards.js";
import { mapKeycloakError } from "../keycloak/errors.js";
import type { ToolContext } from "../tools/shared.js";

export function jsonContents(uri: URL, data: unknown): ReadResourceResult {
  return {
    contents: [
      { uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) },
    ],
  };
}

/** Takes a URI template variable as a single, validated path segment. */
export function segment(value: string | string[] | undefined, label: string): string {
  const single = Array.isArray(value) ? value[0] : value;
  const text = single ?? "";
  assertPathSegment(text, label);
  return text;
}

/** Runs a resource read with the realm allowlist applied and Keycloak errors mapped to clean messages. */
export async function guardedRead<T>(
  ctx: ToolContext,
  name: string,
  realm: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  let outcome = "ok";
  try {
    if (realm !== undefined) assertRealmAllowed(ctx.config, realm, { write: false });
    return await fn();
  } catch (error) {
    const mapped = mapKeycloakError(error, {
      baseUrl: ctx.config.url,
      authRealm: ctx.config.authRealm,
      timeoutMs: ctx.config.timeoutMs,
    });
    outcome = mapped.kind;
    throw mapped;
  } finally {
    ctx.logger.info("resource_read", {
      resource: name,
      realm,
      outcome,
      durationMs: Date.now() - started,
    });
  }
}
