import type { Config } from "./config.js";
import { selectTools } from "./tools/index.js";

/** The protection settings in effect, for the startup line. */
export function protectionStatus(config: Config): Record<string, unknown> {
  return {
    readOnly: config.readOnly,
    toolsets: [...config.toolsets],
    allowedRealms: config.allowedRealms.length > 0 ? [...config.allowedRealms] : "all",
    requireConfirmation: config.requireConfirmation,
    allowMasterWrite: config.allowMasterWrite,
  };
}

/** Warnings about protections that are off; logged once at startup. */
export function protectionWarnings(config: Config): string[] {
  const warnings: string[] = [];
  const writeTools = selectTools(config).filter((tool) => tool.kind !== "read");
  if (writeTools.length > 0 && config.allowedRealms.length === 0) {
    warnings.push(
      `${writeTools.length} write tools are enabled and KEYCLOAK_MCP_REALMS is not set, so they work in every realm the account can manage. Set KEYCLOAK_MCP_REALMS to the realms this server may change, or KEYCLOAK_MCP_READ_ONLY=true.`,
    );
  }
  return warnings;
}
