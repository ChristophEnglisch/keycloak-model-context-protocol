import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../tools/shared.js";
import { DATA_NOTICE, guardRealm, missingToolHint, promptResult, q, realmArg } from "./shared.js";

export const DEFAULT_DAYS = 7;

export function registerInvestigateFailedLogins(server: McpServer, ctx: ToolContext): void {
  server.registerPrompt(
    "investigate_failed_logins",
    {
      title: "Investigate failed logins",
      description:
        "Analyze failed login events in a realm (optionally for one user), check lockout status and summarize patterns without changing anything.",
      argsSchema: z.object({
        realm: realmArg(ctx),
        username: z.string().optional().describe("Limit the analysis to this username."),
        days: z.string().optional().describe(`Look-back window in days (default ${DEFAULT_DAYS}).`),
      }),
    },
    ({ realm, username, days }) => {
      guardRealm(ctx, realm, false);
      const parsed = Number.parseInt(days ?? "", 10);
      const window = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 365) : DEFAULT_DAYS;
      const text = `Investigate failed logins in the Keycloak realm ${q(realm)} over the last ${window} day(s)${username ? ` for the user ${q(username)}` : ""}.

${DATA_NOTICE}
${missingToolHint("event_list or user_brute_force_status", "events, security")} Also note that login events must be enabled in the realm (check realm_get eventsEnabled).

Always pass realm ${q(realm)} explicitly. Steps:

1. Compute dateFrom as today minus ${window} day(s) (format yyyy-MM-dd).${username ? ` Resolve the user ID with user_search (exact username ${q(username)}).` : ""}
2. Call event_list with types ['LOGIN_ERROR'] (also 'CODE_TO_TOKEN_ERROR' and 'CLIENT_LOGIN_ERROR' if relevant), dateFrom${username ? ", and the user filter" : ""}. Page through results.
3. Summarize patterns: count by error reason, by username, by source IP address and by client; time clustering (bursts, off-hours); many users from one IP (spraying) versus many attempts on one user (brute force).
4. For the most affected users call user_brute_force_status and report whether they are currently locked out.
5. Conclude with likely causes (forgotten password, misconfigured client, attack) and recommendations.

This is an investigation only. Do NOT unlock users or change any setting automatically; if unlocking (user_brute_force_unlock) seems appropriate, propose it and wait for explicit confirmation from the human.`;
      return promptResult(`Failed-login investigation for realm ${realm}`, text);
    },
  );
}
