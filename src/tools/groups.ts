import { z } from "zod";
import { ToolError } from "../keycloak/errors.js";
import {
  adminRightsOfGroup,
  assertNotOwnAccount,
  grantPreview,
  ownAccountPreview,
  requireUser,
} from "./privileges.js";
import { defineTool, pageOf, paginationShape, quoted, realmField, toPage } from "./shared.js";
import { toUserSummary } from "./users.js";

const groupSummary = z.object({
  id: z.string().describe("Group ID (UUID); use it as `groupId` in other tools."),
  name: z.string().describe("Group name."),
  path: z.string().optional().describe("Full group path, e.g. /parent/child."),
  subGroupCount: z.number().optional().describe("Number of direct subgroups."),
});

const groupList = defineTool({
  name: "group_list",
  title: "List groups",
  description:
    "List groups of a realm, optionally filtered by a search string, with pagination. Returns id, name, path and number of subgroups.",
  kind: "read",
  input: z.object({
    realm: realmField,
    search: z.string().optional().describe("Only groups whose name contains this text."),
    ...paginationShape,
  }),
  output: pageOf(groupSummary).extend({ realm: z.string().describe("Realm that was queried.") }),
  async handler({ realm, search, first, max }, { gateway }) {
    const rows = await gateway.run((kc) =>
      kc.groups.find({
        realm,
        first,
        max: max + 1,
        briefRepresentation: true,
        ...(search !== undefined && { search }),
      }),
    );
    const items = rows.map((g) => ({
      id: g.id ?? "",
      name: g.name ?? "",
      ...(g.path !== undefined && { path: g.path }),
      ...(g.subGroupCount !== undefined && { subGroupCount: g.subGroupCount }),
    }));
    const page = toPage(items, first, max);
    return {
      data: { ...page, realm },
      summary: `Found ${page.items.length} group(s) in realm '${realm}' (first=${first}, max=${max}${page.hasMore ? ", more available" : ""}).`,
    };
  },
});

const groupMembersList = defineTool({
  name: "group_members_list",
  title: "List group members",
  description: "List the members of a group with a safe subset of user fields, with pagination.",
  kind: "read",
  input: z.object({
    realm: realmField,
    groupId: z.string().min(1).describe("ID (UUID) of the group, e.g. from group_list."),
    ...paginationShape,
  }),
  output: pageOf(
    z.object({
      id: z.string().describe("User ID (UUID)."),
      username: z.string().describe("Login name."),
      email: z.string().optional().describe("E-mail address, if set."),
      firstName: z.string().optional().describe("First name, if set."),
      lastName: z.string().optional().describe("Last name, if set."),
      enabled: z.boolean().optional().describe("Whether the user can log in."),
      emailVerified: z.boolean().optional().describe("Whether the e-mail is verified."),
    }),
  ).extend({
    realm: z.string().describe("Realm that was queried."),
    groupId: z.string().describe("Group that was queried."),
  }),
  async handler({ realm, groupId, first, max }, { gateway }) {
    const rows = await gateway.run((kc) =>
      kc.groups.listMembers({ realm, id: groupId, first, max: max + 1, briefRepresentation: true }),
    );
    const page = toPage(rows.map(toUserSummary), first, max);
    return {
      data: { ...page, realm, groupId },
      summary: `Found ${page.items.length} member(s) in group ${groupId} (first=${first}, max=${max}${page.hasMore ? ", more available" : ""}).`,
    };
  },
});

const membershipOutput = z.object({
  userId: z.string().describe("ID of the user."),
  groupId: z.string().describe("ID of the group."),
  realm: z.string().describe("Realm of the user and group."),
});

const userGroupAdd = defineTool({
  name: "user_group_add",
  title: "Add user to group",
  description:
    "Add a user to a group. The user inherits the roles of the group and of all its parent groups, which can include administrative rights. Requires confirm: true after the user approved the preview. If the group grants administrative rights the preview says so and this confirmation cannot be turned off. The account this server signs in with cannot be added to groups. Adding a user who is already a member has no further effect.",
  kind: "sensitive",
  idempotent: true,
  input: z.object({
    realm: realmField,
    userId: z.string().min(1).describe("ID (UUID) of the user."),
    groupId: z.string().min(1).describe("ID (UUID) of the group."),
  }),
  output: membershipOutput.extend({
    added: z.boolean().describe("True once the user is a member."),
  }),
  async preview({ realm, userId, groupId }, { gateway, config }) {
    return gateway.run(async (kc) => {
      const user = await requireUser(kc, realm, userId);
      assertNotOwnAccount(kc, config, realm, user, "change the group memberships of");
      const group = await kc.groups.findOne({ realm, id: groupId });
      if (!group)
        throw new ToolError("not_found", `Group ${groupId} does not exist in realm '${realm}'.`);
      const rights = await adminRightsOfGroup(kc, realm, { ...group, id: group.id ?? groupId });
      return grantPreview(
        `add user ${quoted(user.username ?? userId)} (id ${userId}) to group ${quoted(group.path ?? group.name ?? groupId)} in realm '${realm}'.`,
        rights,
      );
    });
  },
  async handler({ realm, userId, groupId }, { gateway }) {
    await gateway.run((kc) => kc.users.addToGroup({ realm, id: userId, groupId }));
    return {
      data: { userId, groupId, realm, added: true },
      summary: `User ${userId} is now a member of group ${groupId} in realm '${realm}'.`,
    };
  },
});

const userGroupRemove = defineTool({
  name: "user_group_remove",
  title: "Remove user from group",
  description:
    "Remove a user from a group. This may revoke the roles the user inherits from the group. Requires confirm: true (ask the user first).",
  kind: "destructive",
  idempotent: true,
  input: z.object({
    realm: realmField,
    userId: z.string().min(1).describe("ID (UUID) of the user."),
    groupId: z.string().min(1).describe("ID (UUID) of the group."),
  }),
  output: membershipOutput.extend({
    removed: z.boolean().describe("True once the user is no member."),
  }),
  async preview({ realm, userId, groupId }, { gateway, config }) {
    return gateway.run(async (kc) => {
      const user = await requireUser(kc, realm, userId);
      const group = await kc.groups.findOne({ realm, id: groupId });
      if (!group)
        throw new ToolError("not_found", `Group ${groupId} does not exist in realm '${realm}'.`);
      return ownAccountPreview(
        kc,
        config,
        realm,
        user,
        `remove user ${quoted(user.username ?? userId)} from group ${quoted(group.path ?? group.name ?? groupId)} in realm '${realm}'.`,
      );
    });
  },
  async handler({ realm, userId, groupId }, { gateway }) {
    await gateway.run((kc) => kc.users.delFromGroup({ realm, id: userId, groupId }));
    return {
      data: { userId, groupId, realm, removed: true },
      summary: `User ${userId} is no longer a member of group ${groupId} in realm '${realm}'.`,
    };
  },
});

export const groupTools = [groupList, groupMembersList, userGroupAdd, userGroupRemove];
