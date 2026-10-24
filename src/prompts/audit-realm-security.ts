import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../tools/shared.js";
import { DATA_NOTICE, guardRealm, missingToolHint, promptResult, q, realmArg } from "./shared.js";

export function registerAuditRealmSecurity(server: McpServer, ctx: ToolContext): void {
  server.registerPrompt(
    "audit_realm_security",
    {
      title: "Audit realm security",
      description:
        "Read-only security review of a realm (policies, admin roles, clients, events) that produces a prioritized list of findings.",
      argsSchema: z.object({ realm: realmArg(ctx) }),
    },
    ({ realm }) => {
      guardRealm(ctx, realm, false);
      const text = `Perform a read-only security audit of the Keycloak realm ${q(realm)}. Do not change anything.

${DATA_NOTICE}
${missingToolHint("any tool named below", "core, roles, clients, events")} Report which checks you could not perform because of this.

Always pass realm ${q(realm)} explicitly. Collect evidence with:

1. realm_get: sslRequired (should be 'all' or at least 'external'), bruteForceProtected, passwordPolicy (length, complexity, history), registrationAllowed, verifyEmail, token and session lifespans (long access-token or SSO lifespans), eventsEnabled and adminEventsEnabled.
2. role_list and user_roles_list: who holds administrative or realm-management roles; flag many or unexpected admins and disabled-but-privileged accounts.
3. client_list (page through all results): public clients, clients with directAccessGrantsEnabled, bearer-only or service-account clients with broad access, suspicious redirect or wildcard configuration (use client_get for details of risky ones). Never request or reveal client secrets.
4. event_list and admin_event_list: recent LOGIN_ERROR spikes and unusual admin changes (if events are disabled, that itself is a finding).

Present the result as a prioritized findings list: for each finding give severity (critical, high, medium, low, info), evidence (tool and values), risk, and a concrete recommendation. End with a short summary of what is in good shape. Suggest fixes but do not apply them.`;
      return promptResult(`Security audit of realm ${realm}`, text);
    },
  );
}
