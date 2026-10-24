import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { ToolError } from "../keycloak/errors.js";
import { completeRealmNames } from "../prompts/shared.js";
import type { ToolContext } from "../tools/shared.js";
import { toUserDetails } from "../tools/users.js";
import { guardedRead, jsonContents, segment } from "./shared.js";

export function registerUserResources(server: McpServer, ctx: ToolContext): void {
  server.registerResource(
    "realm-user",
    new ResourceTemplate("keycloak://realms/{realm}/users/{userId}", {
      list: undefined,
      complete: { realm: (value) => completeRealmNames(ctx, value) },
    }),
    {
      title: "Keycloak user",
      description: "Safe subset of one user's fields (no attributes, no credentials).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const realm = segment(variables.realm, "realm");
      const userId = segment(variables.userId, "userId");
      return guardedRead(ctx, "realm-user", realm, async () => {
        const user = await ctx.gateway.run((kc) => kc.users.findOne({ realm, id: userId }));
        if (!user) {
          throw new ToolError("not_found", `User ${userId} does not exist in realm '${realm}'.`);
        }
        return jsonContents(uri, toUserDetails(user));
      });
    },
  );
}
