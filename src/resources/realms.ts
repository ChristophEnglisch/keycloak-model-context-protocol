import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { isRealmAllowed } from "../guards.js";
import { ToolError } from "../keycloak/errors.js";
import { completeRealmNames } from "../prompts/shared.js";
import { toRealmSettings } from "../tools/realms.js";
import type { ToolContext } from "../tools/shared.js";
import { guardedRead, jsonContents, segment } from "./shared.js";

const CLIENT_PAGE = 200;
const CLIENT_PAGES_MAX = 10;

async function listRealmNames(ctx: ToolContext): Promise<string[]> {
  const realms = await ctx.gateway.run((kc) => kc.realms.find({ briefRepresentation: true }));
  return realms
    .map((r) => r.realm)
    .filter((name): name is string => typeof name === "string" && isRealmAllowed(ctx.config, name))
    .sort((a, b) => a.localeCompare(b));
}

async function findRealm(ctx: ToolContext, realm: string) {
  const rep = await ctx.gateway.run((kc) => kc.realms.findOne({ realm }));
  if (!rep) throw new ToolError("not_found", `Realm '${realm}' does not exist.`);
  return rep;
}

export function registerRealmResources(server: McpServer, ctx: ToolContext): void {
  const complete = { realm: (value: string) => completeRealmNames(ctx, value) };

  server.registerResource(
    "realms",
    "keycloak://realms",
    {
      title: "Keycloak realms",
      description: "Names of the realms this server may access (respects KEYCLOAK_MCP_REALMS).",
      mimeType: "application/json",
    },
    async (uri) =>
      guardedRead(ctx, "realms", undefined, async () =>
        jsonContents(uri, { realms: await listRealmNames(ctx) }),
      ),
  );

  server.registerResource(
    "realm",
    new ResourceTemplate("keycloak://realms/{realm}", {
      list: async () => ({
        resources: (await listRealmNames(ctx).catch(() => [])).map((name) => ({
          uri: `keycloak://realms/${encodeURIComponent(name)}`,
          name: `realm-${name}`,
          mimeType: "application/json",
        })),
      }),
      complete,
    }),
    {
      title: "Keycloak realm settings",
      description: "Safe subset of a realm's settings (same fields as the realm_get tool).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const realm = segment(variables.realm, "realm");
      return guardedRead(ctx, "realm", realm, async () => {
        const rep = await findRealm(ctx, realm);
        return jsonContents(uri, toRealmSettings(rep, realm));
      });
    },
  );

  server.registerResource(
    "realm-security-summary",
    new ResourceTemplate("keycloak://realms/{realm}/security-summary", {
      list: undefined,
      complete,
    }),
    {
      title: "Realm security summary",
      description:
        "Aggregated security posture of a realm: brute-force, password policy, SSL, OTP, event flags and client exposure counts. Contains no secrets.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const realm = segment(variables.realm, "realm");
      return guardedRead(ctx, "realm-security-summary", realm, async () => {
        const rep = await findRealm(ctx, realm);
        let publicClients = 0;
        let directAccessGrantsClients = 0;
        let total = 0;
        let truncated = false;
        for (let page = 0; page < CLIENT_PAGES_MAX; page++) {
          const rows = await ctx.gateway.run((kc) =>
            kc.clients.find({ realm, first: page * CLIENT_PAGE, max: CLIENT_PAGE }),
          );
          for (const c of rows) {
            total++;
            if (c.publicClient === true) publicClients++;
            if (c.directAccessGrantsEnabled === true) directAccessGrantsClients++;
          }
          if (rows.length < CLIENT_PAGE) break;
          if (page === CLIENT_PAGES_MAX - 1) truncated = true;
        }
        return jsonContents(uri, {
          realm: rep.realm ?? realm,
          bruteForceProtected: rep.bruteForceProtected ?? false,
          passwordPolicy: rep.passwordPolicy ?? null,
          sslRequired: rep.sslRequired ?? null,
          otpPolicyType: rep.otpPolicyType ?? null,
          eventsEnabled: rep.eventsEnabled ?? false,
          adminEventsEnabled: rep.adminEventsEnabled ?? false,
          clients: {
            total,
            public: publicClients,
            directAccessGrantsEnabled: directAccessGrantsClients,
            truncated,
          },
        });
      });
    },
  );
}
