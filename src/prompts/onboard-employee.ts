import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../tools/shared.js";
import {
  DATA_NOTICE,
  guardRealm,
  missingToolHint,
  promptResult,
  q,
  realmArg,
  splitList,
} from "./shared.js";

export function registerOnboardEmployee(server: McpServer, ctx: ToolContext): void {
  server.registerPrompt(
    "onboard_employee",
    {
      title: "Onboard employee",
      description:
        "Guided workflow to create a Keycloak user for a new employee, assign groups and roles and send the welcome e-mail.",
      argsSchema: z.object({
        realm: realmArg(ctx),
        username: z.string().min(1).describe("Username for the new account."),
        email: z.string().min(1).describe("E-mail address of the new employee."),
        firstName: z.string().min(1).describe("First name."),
        lastName: z.string().min(1).describe("Last name."),
        groups: z.string().optional().describe("Comma-separated list of group names to join."),
        roles: z.string().optional().describe("Comma-separated list of realm roles to assign."),
      }),
    },
    ({ realm, username, email, firstName, lastName, groups, roles }) => {
      guardRealm(ctx, realm, true);
      const groupList = splitList(groups);
      const roleList = splitList(roles);
      const text = `You are onboarding a new employee in the Keycloak realm ${q(realm)}.

Requested account (values supplied by the user):
- username: ${q(username)}
- email: ${q(email)}
- first name: ${q(firstName)}
- last name: ${q(lastName)}
- groups: ${groupList.length ? groupList.map(q).join(", ") : "none"}
- realm roles: ${roleList.length ? roleList.map(q).join(", ") : "none"}

${DATA_NOTICE}
${missingToolHint("a tool named below", "core (user tools), groups, roles")}

Work step by step and always pass realm ${q(realm)} explicitly. Before EVERY step that changes something, summarize in one or two sentences what you are about to do. Tools that change something first return a preview and change nothing: show the preview to the user and repeat the call with confirm: true only after the user approved it.

1. Duplicate check: call user_search with exact username and again with exact email. If a user already exists, stop and report it; do not create a second account.
2. Create the user with user_create (username, email, firstName, lastName). Report the new user ID.
3. Groups: ${
        groupList.length
          ? "look up each group with group_list (names must match exactly; ask the user if one is missing, never invent groups) and add the user with user_group_add."
          : "skip (none requested)."
      }
4. Roles: ${
        roleList.length
          ? "verify each role exists with role_list, then assign them with user_role_assign. Ask the user before assigning any admin-like role."
          : "skip (none requested)."
      }
5. Welcome e-mail: send user_send_actions_email with actions UPDATE_PASSWORD and VERIFY_EMAIL so the employee sets their own password. Never set or ask for a password yourself.
6. Verify with user_get (and user_roles_list if roles were assigned) and finish with a short summary of what was created.

If any step fails, stop, explain the error and propose how to proceed; do not delete or recreate anything on your own.`;
      return promptResult(`Onboard ${username} in realm ${realm}`, text);
    },
  );
}
