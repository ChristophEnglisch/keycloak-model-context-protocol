import { z } from "zod";
import { ToolError } from "../keycloak/errors.js";
import { defineTool, pageOf, paginationShape, realmField, toPage } from "./shared.js";

const HIDDEN_CLIENTS_HINT =
  "If clients exist, the account may lack the realm-management roles query-clients/view-clients (Keycloak before 26.8 hides clients instead of returning HTTP 403).";

type ClientRep = {
  id?: string;
  clientId?: string;
  name?: string;
  enabled?: boolean;
  protocol?: string;
  publicClient?: boolean;
  bearerOnly?: boolean;
  serviceAccountsEnabled?: boolean;
  standardFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  rootUrl?: string;
  baseUrl?: string;
  redirectUris?: string[];
  webOrigins?: string[];
  defaultClientScopes?: string[];
  optionalClientScopes?: string[];
};

const clientSummary = z.object({
  id: z.string().describe("Internal client ID (UUID); use it as `id` in client_get."),
  clientId: z.string().describe("Public client identifier used in protocol requests."),
  name: z.string().optional().describe("Display name, if set."),
  enabled: z.boolean().optional().describe("Whether the client is enabled."),
  protocol: z.string().optional().describe("Protocol, e.g. openid-connect or saml."),
  publicClient: z.boolean().optional().describe("True for public clients (no client secret)."),
  bearerOnly: z.boolean().optional().describe("True if the client only accepts bearer tokens."),
  serviceAccountsEnabled: z.boolean().optional().describe("Whether a service account is enabled."),
  standardFlowEnabled: z
    .boolean()
    .optional()
    .describe("Whether the authorization code flow is on."),
  directAccessGrantsEnabled: z
    .boolean()
    .optional()
    .describe("Whether the direct access (password) grant is on."),
});

const clientDetail = clientSummary.extend({
  rootUrl: z.string().optional().describe("Root URL, if set."),
  baseUrl: z.string().optional().describe("Base URL, if set."),
  redirectUris: z.array(z.string()).describe("Valid redirect URIs."),
  webOrigins: z.array(z.string()).describe("Allowed web origins (CORS)."),
  defaultClientScopes: z.array(z.string()).describe("Default client scope names."),
  optionalClientScopes: z.array(z.string()).describe("Optional client scope names."),
});

/** Allowlist projection: secret, registrationAccessToken, attributes and mappers never pass. */
export function toClientSummary(c: ClientRep): z.infer<typeof clientSummary> {
  return {
    id: c.id ?? "",
    clientId: c.clientId ?? "",
    ...(c.name !== undefined && { name: c.name }),
    ...(c.enabled !== undefined && { enabled: c.enabled }),
    ...(c.protocol !== undefined && { protocol: c.protocol }),
    ...(c.publicClient !== undefined && { publicClient: c.publicClient }),
    ...(c.bearerOnly !== undefined && { bearerOnly: c.bearerOnly }),
    ...(c.serviceAccountsEnabled !== undefined && {
      serviceAccountsEnabled: c.serviceAccountsEnabled,
    }),
    ...(c.standardFlowEnabled !== undefined && { standardFlowEnabled: c.standardFlowEnabled }),
    ...(c.directAccessGrantsEnabled !== undefined && {
      directAccessGrantsEnabled: c.directAccessGrantsEnabled,
    }),
  };
}

const clientList = defineTool({
  name: "client_list",
  title: "List clients",
  description:
    "List clients of a realm with pagination, optionally filtered by clientId (prefix/infix search). Returns basic flags only; never secrets. Without the query-clients role, Keycloak before 26.8 silently returns only the clients the account holds roles of.",
  kind: "read",
  input: z.object({
    realm: realmField,
    search: z
      .string()
      .optional()
      .describe("Search term matched against the clientId (substring match)."),
    ...paginationShape,
  }),
  output: pageOf(clientSummary).extend({ realm: z.string().describe("Realm that was queried.") }),
  async handler({ realm, search, first, max }, { gateway }) {
    const rows = await gateway.run((kc) =>
      kc.clients.find({
        realm,
        first,
        max: max + 1,
        ...(search !== undefined && { clientId: search, search: true }),
      }),
    );
    const page = toPage(rows.map(toClientSummary), first, max);
    // Keycloak before 26.8 returns an empty list instead of 403 without client permissions.
    const hint =
      page.items.length === 0 && first === 0 && search === undefined
        ? ` ${HIDDEN_CLIENTS_HINT}`
        : "";
    return {
      data: { ...page, realm },
      summary: `Found ${page.items.length} client(s) in realm '${realm}' (first=${first}, max=${max}${page.hasMore ? ", more available" : ""}).${hint}`,
    };
  },
});

const clientGet = defineTool({
  name: "client_get",
  title: "Get client",
  description:
    "Get one client by internal `id` or by `clientId` (exactly one of them). Returns URLs, redirect URIs, web origins and client scope names. Secrets, attributes and protocol mapper configs are never returned.",
  kind: "read",
  input: z
    .object({
      realm: realmField,
      id: z.string().min(1).optional().describe("Internal client ID (UUID) from client_list."),
      clientId: z.string().min(1).optional().describe("Public clientId, e.g. 'my-app'."),
    })
    .refine((v) => (v.id === undefined) !== (v.clientId === undefined), {
      message: "Provide exactly one of `id` or `clientId`.",
    }),
  output: clientDetail,
  async handler({ realm, id, clientId }, { gateway }) {
    const found = await gateway.run(async (kc) => {
      let rep: ClientRep | undefined;
      if (id !== undefined) {
        rep = await kc.clients.findOne({ realm, id });
      } else {
        const matches = await kc.clients.find({ realm, clientId, max: 1 });
        rep = matches.find((c) => c.clientId === clientId);
      }
      if (!rep?.id) return undefined;
      const internalId = rep.id;
      const [defaults, optionals] = await Promise.all([
        kc.clients.listDefaultClientScopes({ realm, id: internalId }),
        kc.clients.listOptionalClientScopes({ realm, id: internalId }),
      ]);
      return { rep, defaults, optionals };
    });
    if (!found) {
      throw new ToolError(
        "not_found",
        `Client ${id ?? clientId} was not found in realm '${realm}'. ${HIDDEN_CLIENTS_HINT}`,
      );
    }
    const { rep, defaults, optionals } = found;
    const names = (scopes: { name?: string }[]) =>
      scopes.flatMap((s) => (s.name !== undefined ? [s.name] : []));
    const client = {
      ...toClientSummary(rep),
      ...(rep.rootUrl !== undefined && { rootUrl: rep.rootUrl }),
      ...(rep.baseUrl !== undefined && { baseUrl: rep.baseUrl }),
      redirectUris: rep.redirectUris ?? [],
      webOrigins: rep.webOrigins ?? [],
      defaultClientScopes: names(defaults),
      optionalClientScopes: names(optionals),
    };
    return {
      data: client,
      summary: `Retrieved client ${client.id} from realm '${realm}'.`,
    };
  },
});

export const clientTools = [clientList, clientGet];
