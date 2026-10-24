import type { McpServer } from "@modelcontextprotocol/server";
import type { Config, ToolsetName } from "../config.js";
import { clientTools } from "./clients.js";
import { eventTools } from "./events.js";
import { groupTools } from "./groups.js";
import { realmTools } from "./realms.js";
import { roleTools } from "./roles.js";
import { securityTools } from "./security.js";
import { sessionTools } from "./sessions.js";
import type { ToolContext, ToolDefinition } from "./shared.js";
import { userTools } from "./users.js";

/** Every toolset and its tools. A new tool only needs to be added to its domain file. */
export const TOOLSETS: Record<ToolsetName, readonly ToolDefinition[]> = {
  core: [...realmTools, ...userTools],
  groups: groupTools,
  roles: roleTools,
  clients: clientTools,
  sessions: sessionTools,
  events: eventTools,
  security: securityTools,
};

/** Tools enabled by config: selected toolsets, minus write tools in read-only mode. */
export function selectTools(config: Pick<Config, "toolsets" | "readOnly">): ToolDefinition[] {
  return Object.entries(TOOLSETS)
    .filter(([name]) => config.toolsets.has(name as ToolsetName))
    .flatMap(([, tools]) => tools)
    .filter((tool) => !config.readOnly || tool.kind === "read");
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  for (const tool of selectTools(ctx.config)) {
    tool.register(server, ctx);
  }
}
