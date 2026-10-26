import type KcAdminClient from "@keycloak/keycloak-admin-client";
import { z } from "zod";
import { assertPathSegment } from "../guards.js";
import { ToolError } from "../keycloak/errors.js";
import {
  adminRightsOfRoles,
  assertNotOwnAccount,
  grantPreview,
  ownAccountPreview,
  type RoleRef,
  requireUser,
} from "./privileges.js";
import { defineTool, pageOf, paginationShape, quoted, realmField, toPage } from "./shared.js";

export { isPrivilegedRole } from "./privileges.js";

const roleSummary = z.object({
  name: z.string().describe("Role name."),
  description: z.string().optional().describe("Role description, if set."),
  composite: z.boolean().optional().describe("Whether the role is composite."),
  clientRole: z.boolean().optional().describe("Whether this is a client role."),
});

type RoleRep = {
  id?: string;
  name?: string;
  description?: string;
  composite?: boolean;
  clientRole?: boolean;
};

function toRoleSummary(role: RoleRep): z.infer<typeof roleSummary> {
  return {
    name: role.name ?? "",
    ...(role.description !== undefined && { description: role.description }),
    ...(role.composite !== undefined && { composite: role.composite }),
    ...(role.clientRole !== undefined && { clientRole: role.clientRole }),
  };
}

const clientIdField = z
  .string()
  .min(1)
  .optional()
  .describe("Client ID (the readable `clientId`, not the internal UUID). Omit for realm roles.");

/** Resolves a readable clientId to the client's internal id. */
async function lookupClientUuid(kc: KcAdminClient, realm: string, clientId: string) {
  const clients = await kc.clients.find({ realm, clientId });
  const match = clients.find((c) => c.clientId === clientId);
  if (!match?.id)
    throw new ToolError("not_found", `Client '${clientId}' does not exist in realm '${realm}'.`);
  return match.id;
}

const roleList = defineTool({
  name: "role_list",
  title: "List roles",
  description:
    "List realm roles, or the roles of one client when `clientId` is given, optionally filtered by a search string, with pagination.",
  kind: "read",
  input: z.object({
    realm: realmField,
    clientId: clientIdField,
    search: z.string().optional().describe("Only roles whose name contains this text."),
    ...paginationShape,
  }),
  output: pageOf(roleSummary).extend({
    realm: z.string().describe("Realm that was queried."),
    clientId: z.string().optional().describe("Client whose roles were listed, if any."),
  }),
  async handler({ realm, clientId, search, first, max }, { gateway }) {
    const rows = await gateway.run(async (kc) => {
      if (clientId === undefined) {
        return kc.roles.find({
          realm,
          first,
          max: max + 1,
          briefRepresentation: true,
          ...(search !== undefined && { search }),
        });
      }
      const id = await lookupClientUuid(kc, realm, clientId);
      // The client-roles endpoint has no paging in the admin client; slice locally.
      const all = await kc.clients.listRoles({ realm, id });
      const needle = search?.toLowerCase();
      return all
        .filter((r) => needle === undefined || (r.name ?? "").toLowerCase().includes(needle))
        .slice(first, first + max + 1);
    });
    const page = toPage(rows.map(toRoleSummary), first, max);
    return {
      data: { ...page, realm, ...(clientId !== undefined && { clientId }) },
      summary: `Found ${page.items.length} role(s) in realm '${realm}' (first=${first}, max=${max}${page.hasMore ? ", more available" : ""}).`,
    };
  },
});

const userRolesList = defineTool({
  name: "user_roles_list",
  title: "List user role mappings",
  description:
    "List the realm and client roles assigned to a user. With effective=true, composite roles are expanded; client roles are then resolved for `clientId` if given, otherwise for the clients the user has direct client-role mappings in. Optional `clientId` limits client roles to that client.",
  kind: "read",
  input: z.object({
    realm: realmField,
    userId: z.string().min(1).describe("ID (UUID) of the user."),
    clientId: clientIdField,
    effective: z
      .boolean()
      .default(false)
      .describe("If true, include roles inherited via composite roles (default false)."),
  }),
  output: z.object({
    realm: z.string().describe("Realm of the user."),
    userId: z.string().describe("ID of the user."),
    effective: z.boolean().describe("Whether composite roles were expanded."),
    realmRoles: z.array(roleSummary).describe("Realm roles of the user."),
    clientRoles: z
      .array(
        z.object({
          clientId: z.string().describe("Client the roles belong to."),
          roles: z.array(roleSummary).describe("Roles of the user in that client."),
        }),
      )
      .describe("Client roles of the user, grouped by client."),
  }),
  async handler({ realm, userId, clientId, effective }, { gateway }) {
    const data = await gateway.run(async (kc) => {
      const mappings = await kc.users.listRoleMappings({ realm, id: userId });
      const realmRoles = effective
        ? await kc.users.listCompositeRealmRoleMappings({ realm, id: userId })
        : (mappings.realmMappings ?? []);
      const direct = Object.entries(
        (mappings.clientMappings ?? {}) as Record<
          string,
          { id?: string; client?: string; mappings?: RoleRep[] }
        >,
      );
      let clientRoles: { clientId: string; roles: ReturnType<typeof toRoleSummary>[] }[];
      if (!effective) {
        clientRoles = direct
          .filter(([key, v]) => clientId === undefined || (v.client ?? key) === clientId)
          .map(([key, v]) => ({
            clientId: v.client ?? key,
            roles: (v.mappings ?? []).map(toRoleSummary),
          }));
      } else {
        const targets =
          clientId === undefined
            ? direct.map(([key, v]) => ({ clientId: v.client ?? key, uuid: v.id }))
            : [{ clientId, uuid: undefined as string | undefined }];
        clientRoles = [];
        for (const t of targets) {
          const uuid = t.uuid ?? (await lookupClientUuid(kc, realm, t.clientId));
          const roles = await kc.users.listCompositeClientRoleMappings({
            realm,
            id: userId,
            clientUniqueId: uuid,
          });
          clientRoles.push({ clientId: t.clientId, roles: roles.map(toRoleSummary) });
        }
      }
      return { realm, userId, effective, realmRoles: realmRoles.map(toRoleSummary), clientRoles };
    });
    const clientCount = data.clientRoles.reduce((n, c) => n + c.roles.length, 0);
    return {
      data,
      summary: `User ${userId} has ${data.realmRoles.length} realm role(s) and ${clientCount} client role(s) in realm '${realm}'${effective ? " (effective)" : ""}.`,
    };
  },
});

// ---------------------------------------------------------------------------
// Assign / revoke
// ---------------------------------------------------------------------------

interface ResolvedRole extends RoleRef {
  id: string;
  name: string;
}

async function resolveRoles(
  kc: KcAdminClient,
  realm: string,
  names: readonly string[],
  clientId: string | undefined,
): Promise<{ roles: ResolvedRole[]; clientUuid?: string }> {
  for (const name of names) assertPathSegment(name, "role name");
  const clientUuid =
    clientId === undefined ? undefined : await lookupClientUuid(kc, realm, clientId);
  const roles: ResolvedRole[] = [];
  const missing: string[] = [];
  for (const name of new Set(names)) {
    const rep =
      clientUuid === undefined
        ? await kc.roles.findOneByName({ realm, name })
        : await kc.clients.findRole({ realm, id: clientUuid, roleName: name });
    if (rep?.id) roles.push({ ...rep, id: rep.id, name });
    else missing.push(name);
  }
  if (missing.length > 0) {
    const where =
      clientId === undefined ? `realm '${realm}'` : `client '${clientId}' in realm '${realm}'`;
    throw new ToolError(
      "not_found",
      `Unknown role(s) in ${where}: ${missing.join(", ")}. Nothing was changed.`,
    );
  }
  return clientUuid === undefined ? { roles } : { roles, clientUuid };
}

/** Only id and name go to Keycloak when mapping roles. */
const roleRefs = (roles: readonly ResolvedRole[]) => roles.map(({ id, name }) => ({ id, name }));

const roleScope = (clientId: string | undefined) =>
  clientId === undefined ? "realm" : `client ${quoted(clientId)}`;

const roleNames = (names: readonly string[]) => names.map((n) => quoted(n)).join(", ");

const rolesField = z
  .array(z.string().min(1))
  .min(1)
  .max(50)
  .describe("Role names (not IDs), e.g. ['editor']. Use role_list to see available roles.");

const roleMutationOutput = z.object({
  realm: z.string().describe("Realm of the user."),
  userId: z.string().describe("ID of the user."),
  clientId: z.string().optional().describe("Client of the roles; absent for realm roles."),
  roles: z.array(z.string()).describe("Role names that were processed."),
});

const userRoleAssign = defineTool({
  name: "user_role_assign",
  title: "Assign roles to user",
  description:
    "Assign realm roles (or roles of one client when `clientId` is given) to a user. Unknown roles abort the call without changes. Requires confirm: true after the user approved the preview. If the roles grant administrative rights, directly or through composite roles, the preview says so and this confirmation cannot be turned off. Roles of the account this server signs in with cannot be changed.",
  kind: "sensitive",
  idempotent: true,
  input: z.object({
    realm: realmField,
    userId: z.string().min(1).describe("ID (UUID) of the user."),
    roles: rolesField,
    clientId: clientIdField,
  }),
  output: roleMutationOutput.extend({
    assigned: z.boolean().describe("True once the roles are assigned."),
  }),
  async preview({ realm, userId, roles: names, clientId }, { gateway, config }) {
    return gateway.run(async (kc) => {
      const user = await requireUser(kc, realm, userId);
      assertNotOwnAccount(kc, config, realm, user, "change the roles of");
      const found = await resolveRoles(kc, realm, names, clientId);
      const rights = await adminRightsOfRoles(kc, realm, found.roles, clientId);
      return grantPreview(
        `assign ${roleScope(clientId)} role(s) ${roleNames(found.roles.map((r) => r.name))} to user ${quoted(user.username ?? userId)} (id ${userId}) in realm '${realm}'.`,
        rights,
      );
    });
  },
  async handler({ realm, userId, roles: names, clientId }, { gateway }) {
    const resolved = await gateway.run(async (kc) => {
      const found = await resolveRoles(kc, realm, names, clientId);
      if (found.clientUuid === undefined) {
        await kc.users.addRealmRoleMappings({ realm, id: userId, roles: roleRefs(found.roles) });
      } else {
        await kc.users.addClientRoleMappings({
          realm,
          id: userId,
          clientUniqueId: found.clientUuid,
          roles: roleRefs(found.roles),
        });
      }
      return found.roles;
    });
    const roles = resolved.map((r) => r.name);
    return {
      data: { realm, userId, ...(clientId !== undefined && { clientId }), roles, assigned: true },
      summary: `Assigned ${roles.length} role(s) to user ${userId} in realm '${realm}'.`,
    };
  },
});

const userRoleRevoke = defineTool({
  name: "user_role_revoke",
  title: "Revoke roles from user",
  description:
    "Remove realm roles (or roles of one client when `clientId` is given) from a user. Unknown roles abort the call without changes. Requires confirm: true (ask the user first).",
  kind: "destructive",
  idempotent: true,
  input: z.object({
    realm: realmField,
    userId: z.string().min(1).describe("ID (UUID) of the user."),
    roles: rolesField,
    clientId: clientIdField,
  }),
  output: roleMutationOutput.extend({
    revoked: z.boolean().describe("True once the roles are removed."),
  }),
  async preview({ realm, userId, roles, clientId }, { gateway, config }) {
    return gateway.run(async (kc) => {
      const user = await requireUser(kc, realm, userId);
      return ownAccountPreview(
        kc,
        config,
        realm,
        user,
        `remove ${roleScope(clientId)} role(s) ${roleNames(roles)} from user ${quoted(user.username ?? userId)} in realm '${realm}'.`,
      );
    });
  },
  async handler({ realm, userId, roles: names, clientId }, { gateway }) {
    const resolved = await gateway.run(async (kc) => {
      const found = await resolveRoles(kc, realm, names, clientId);
      if (found.clientUuid === undefined) {
        await kc.users.delRealmRoleMappings({ realm, id: userId, roles: roleRefs(found.roles) });
      } else {
        await kc.users.delClientRoleMappings({
          realm,
          id: userId,
          clientUniqueId: found.clientUuid,
          roles: roleRefs(found.roles),
        });
      }
      return found.roles;
    });
    const roles = resolved.map((r) => r.name);
    return {
      data: { realm, userId, ...(clientId !== undefined && { clientId }), roles, revoked: true },
      summary: `Revoked ${roles.length} role(s) from user ${userId} in realm '${realm}'.`,
    };
  },
});

export const roleTools = [roleList, userRolesList, userRoleAssign, userRoleRevoke];
