import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../tools/shared.js";
import { registerAuditRealmSecurity } from "./audit-realm-security.js";
import { registerInvestigateFailedLogins } from "./investigate-failed-logins.js";
import { registerOffboardEmployee } from "./offboard-employee.js";
import { registerOnboardEmployee } from "./onboard-employee.js";

/** Registers MCP prompts (guided multi-step workflows built on the existing tools). */
export function registerPrompts(server: McpServer, ctx: ToolContext): void {
  registerOnboardEmployee(server, ctx);
  registerOffboardEmployee(server, ctx);
  registerAuditRealmSecurity(server, ctx);
  registerInvestigateFailedLogins(server, ctx);
}
