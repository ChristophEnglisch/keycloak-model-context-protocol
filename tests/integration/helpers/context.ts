import { describe, inject } from "vitest";
import type { KeycloakInfo } from "../global-setup.js";

/** True when a Keycloak is available (Docker container or IT_KEYCLOAK_URL). */
export const keycloakAvailable = inject("itKeycloak") !== null;

/** Use instead of `describe`: the suite is skipped (with a reason in the log) without Docker. */
export const describeIt = describe.skipIf(!keycloakAvailable);

export function keycloak(): KeycloakInfo {
  const info = inject("itKeycloak");
  if (info === null) throw new Error(`Integration tests need Keycloak: ${inject("itSkipReason")}`);
  return info;
}
