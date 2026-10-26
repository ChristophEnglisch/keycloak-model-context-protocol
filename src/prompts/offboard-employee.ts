import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../tools/shared.js";
import { DATA_NOTICE, guardRealm, missingToolHint, promptResult, q, realmArg } from "./shared.js";

export function registerOffboardEmployee(server: McpServer, ctx: ToolContext): void {
  server.registerPrompt(
    "offboard_employee",
    {
      title: "Offboard employee",
      description:
        "Guided workflow to safely deactivate a departing employee: review the account, end sessions and disable it (without deleting).",
      argsSchema: z.object({
        realm: realmArg(ctx),
        username: z.string().min(1).describe("Username of the departing employee."),
      }),
    },
    ({ realm, username }) => {
      guardRealm(ctx, realm, true);
      const text = `You are offboarding the user ${q(username)} in the Keycloak realm ${q(realm)}.

${DATA_NOTICE}
${missingToolHint("a tool named below", "core, sessions (user_sessions_list, user_logout)")}

Always pass realm ${q(realm)} explicitly. Steps:

1. Find the user with user_search (exact username). If there is no match or more than one, stop and ask the user.
2. Call user_get with the ID and show the user the identity (username, name, e-mail, enabled state) so they can confirm it is the right person.
3. Call user_sessions_list to show active sessions and the clients involved.
4. Ask for explicit confirmation, then end all sessions with user_logout (this is destructive; it needs confirm: true only after the human approved).
5. Disable the account with user_update and enabled=false. Show the returned preview and repeat the call with confirm: true only after the human approved.
6. Verify with user_get that enabled is false and report the result.

Do NOT delete the user (no user_delete) unless the human explicitly asks for deletion in this conversation; disabling preserves audit trails and allows rollback. Do not change group or role memberships unless asked.`;
      return promptResult(`Offboard ${username} in realm ${realm}`, text);
    },
  );
}
