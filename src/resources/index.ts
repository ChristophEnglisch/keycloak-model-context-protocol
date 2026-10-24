import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../tools/shared.js";
import { registerRealmResources } from "./realms.js";
import { registerUserResources } from "./users.js";

/** Registers MCP resources (read-only, JSON). Same guards as the tools. */
export function registerResources(server: McpServer, ctx: ToolContext): void {
  registerRealmResources(server, ctx);
  registerUserResources(server, ctx);
}
