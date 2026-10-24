import { z } from "zod";
import { defineTool, pageOf, paginationShape, realmField, toPage } from "./shared.js";

const dateField = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .describe(`${label} (YYYY-MM-DD, inclusive).`);

const SENSITIVE_KEY = /token|secret|password|credential|^code$/i;

/** Keeps string-valued detail entries, dropping anything that looks like a token or secret. */
function safeDetails(details: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}

const iso = (ms: number | undefined) => (ms === undefined ? undefined : new Date(ms).toISOString());

const DISABLED_HINT =
  " The list is empty; events may be disabled for this realm (check the realm's event settings).";

const loginEvent = z.object({
  time: z.string().optional().describe("Event time (ISO 8601)."),
  type: z.string().optional().describe("Event type, e.g. LOGIN or LOGIN_ERROR."),
  userId: z.string().optional().describe("User ID, if known."),
  clientId: z.string().optional().describe("Client involved, if known."),
  ipAddress: z.string().optional().describe("Source IP address."),
  error: z.string().optional().describe("Error code for failed events."),
  details: z.record(z.string(), z.string()).describe("Event details; tokens are removed."),
});

const eventList = defineTool({
  name: "event_list",
  title: "List login events",
  description:
    "List user/login events of a realm (logins, failed logins, logouts, password changes) with filters and pagination. Requires event storage to be enabled in the realm.",
  kind: "read",
  input: z.object({
    realm: realmField,
    type: z
      .array(z.string().min(1))
      .optional()
      .describe("Event types to include, e.g. ['LOGIN', 'LOGIN_ERROR']."),
    user: z.string().optional().describe("Filter by user ID."),
    client: z.string().optional().describe("Filter by clientId."),
    ipAddress: z.string().optional().describe("Filter by source IP address."),
    dateFrom: dateField("Earliest event date"),
    dateTo: dateField("Latest event date"),
    ...paginationShape,
  }),
  output: pageOf(loginEvent).extend({ realm: z.string().describe("Realm that was queried.") }),
  async handler(
    { realm, type, user, client, ipAddress, dateFrom, dateTo, first, max },
    { gateway },
  ) {
    const rows = await gateway.run((kc) =>
      kc.realms.findEvents({
        realm,
        first,
        max: max + 1,
        // Event types are validated by Keycloak; the client's union type is too narrow for free input.
        ...(type !== undefined && { type: type as never }),
        ...(user !== undefined && { user }),
        ...(client !== undefined && { client }),
        ...(ipAddress !== undefined && { ipAddress }),
        ...(dateFrom !== undefined && { dateFrom }),
        ...(dateTo !== undefined && { dateTo }),
      }),
    );
    const mapped = rows.map((e) => ({
      ...(e.time !== undefined && { time: iso(e.time) }),
      ...(e.type !== undefined && { type: e.type }),
      ...(e.userId !== undefined && { userId: e.userId }),
      ...(e.clientId !== undefined && { clientId: e.clientId }),
      ...(e.ipAddress !== undefined && { ipAddress: e.ipAddress }),
      ...(e.error !== undefined && { error: e.error }),
      details: safeDetails(e.details),
    }));
    const page = toPage(mapped, first, max);
    const empty = page.items.length === 0 && first === 0;
    return {
      data: { ...page, realm },
      summary: `Found ${page.items.length} event(s) in realm '${realm}'${page.hasMore ? " (more available)" : ""}.${empty ? DISABLED_HINT : ""}`,
    };
  },
});

const adminEvent = z.object({
  time: z.string().optional().describe("Event time (ISO 8601)."),
  operationType: z.string().optional().describe("CREATE, UPDATE, DELETE or ACTION."),
  resourceType: z.string().optional().describe("Type of the changed resource, e.g. USER."),
  resourcePath: z.string().optional().describe("Path of the changed resource."),
  authDetails: z
    .object({
      userId: z.string().optional().describe("Admin user who made the change."),
      realmId: z.string().optional().describe("Realm of the admin user."),
      clientId: z.string().optional().describe("Client used for the change."),
      ipAddress: z.string().optional().describe("Source IP address."),
    })
    .optional()
    .describe("Who performed the operation."),
  error: z.string().optional().describe("Error code if the operation failed."),
});

const adminEventList = defineTool({
  name: "admin_event_list",
  title: "List admin events",
  description:
    "List admin (audit) events of a realm: who changed which resource and when. The change payload is deliberately omitted. Requires admin events to be enabled in the realm.",
  kind: "read",
  input: z.object({
    realm: realmField,
    operationTypes: z
      .array(z.string().min(1))
      .optional()
      .describe("Operation types to include: CREATE, UPDATE, DELETE, ACTION."),
    resourceTypes: z
      .array(z.string().min(1))
      .optional()
      .describe("Resource types to include, e.g. ['USER', 'CLIENT']."),
    resourcePath: z.string().optional().describe("Resource path filter; '*' wildcards allowed."),
    authUser: z.string().optional().describe("Filter by ID of the acting admin user."),
    dateFrom: dateField("Earliest event date"),
    dateTo: dateField("Latest event date"),
    ...paginationShape,
  }),
  output: pageOf(adminEvent).extend({ realm: z.string().describe("Realm that was queried.") }),
  async handler(
    { realm, operationTypes, resourceTypes, resourcePath, authUser, dateFrom, dateTo, first, max },
    { gateway },
  ) {
    const rows = await gateway.run((kc) =>
      kc.realms.findAdminEvents({
        realm,
        first,
        max: max + 1,
        // The client serializes arrays as repeated params and Dates via toString(); the typings
        // say string/Date, but Keycloak wants repeated params and YYYY-MM-DD strings.
        ...(operationTypes !== undefined && {
          operationTypes: operationTypes as unknown as string,
        }),
        ...(resourceTypes !== undefined && { resourceTypes: resourceTypes as unknown as string }),
        ...(resourcePath !== undefined && { resourcePath }),
        ...(authUser !== undefined && { authUser }),
        ...(dateFrom !== undefined && { dateFrom: dateFrom as unknown as Date }),
        ...(dateTo !== undefined && { dateTo: dateTo as unknown as Date }),
      }),
    );
    const mapped = rows.map((e) => {
      const a = e.authDetails;
      const authDetails = a && {
        ...(a.userId !== undefined && { userId: a.userId }),
        ...(a.realmId !== undefined && { realmId: a.realmId }),
        ...(a.clientId !== undefined && { clientId: a.clientId }),
        ...(a.ipAddress !== undefined && { ipAddress: a.ipAddress }),
      };
      return {
        ...(e.time !== undefined && { time: iso(e.time) }),
        ...(e.operationType !== undefined && { operationType: e.operationType }),
        ...(e.resourceType !== undefined && { resourceType: e.resourceType }),
        ...(e.resourcePath !== undefined && { resourcePath: e.resourcePath }),
        ...(authDetails && { authDetails }),
        ...(e.error !== undefined && { error: e.error }),
      };
    });
    const page = toPage(mapped, first, max);
    const empty = page.items.length === 0 && first === 0;
    return {
      data: { ...page, realm },
      summary: `Found ${page.items.length} admin event(s) in realm '${realm}'${page.hasMore ? " (more available)" : ""}.${empty ? DISABLED_HINT : ""}`,
    };
  },
});

export const eventTools = [eventList, adminEventList];
