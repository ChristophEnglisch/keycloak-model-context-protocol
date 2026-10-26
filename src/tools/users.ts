import { z } from "zod";
import { ToolError } from "../keycloak/errors.js";
import {
  adminRightsOfUser,
  assertNotOwnAccount,
  ownAccountPreview,
  requireUser,
  targetRightsNote,
} from "./privileges.js";
import { defineTool, pageOf, paginationShape, quoted, realmField, toPage } from "./shared.js";

const userSummary = z.object({
  id: z.string().describe("User ID (UUID); use it as `userId` in other tools."),
  username: z.string().describe("Login name."),
  email: z.string().optional().describe("E-mail address, if set."),
  firstName: z.string().optional().describe("First name, if set."),
  lastName: z.string().optional().describe("Last name, if set."),
  enabled: z.boolean().optional().describe("Whether the user can log in."),
  emailVerified: z.boolean().optional().describe("Whether the e-mail address is verified."),
});

type UserRep = {
  id?: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
};

/** Projects a Keycloak user onto the safe subset we expose (no attributes, no credentials). */
export function toUserSummary(user: UserRep): z.infer<typeof userSummary> {
  return {
    id: user.id ?? "",
    username: user.username ?? "",
    ...(user.email !== undefined && { email: user.email }),
    ...(user.firstName !== undefined && { firstName: user.firstName }),
    ...(user.lastName !== undefined && { lastName: user.lastName }),
    ...(user.enabled !== undefined && { enabled: user.enabled }),
    ...(user.emailVerified !== undefined && { emailVerified: user.emailVerified }),
  };
}

/** Upper bound for the validity of links sent by user_send_actions_email: 24 hours. */
export const MAX_ACTIONS_EMAIL_LIFESPAN = 86_400;

// Pattern for list tools: paginationShape in, pageOf() out, query max + 1 and use toPage().
const userSearch = defineTool({
  name: "user_search",
  title: "Search users",
  description:
    "Search users in a realm by free text and/or exact fields, with pagination. Without filters it lists all users. Use `search` for a general match on username, name and e-mail (prefix/infix); set `exact` to match username/email exactly.",
  kind: "read",
  input: z.object({
    realm: realmField,
    search: z.string().optional().describe("Free-text search across username, name and e-mail."),
    username: z.string().optional().describe("Filter by username."),
    email: z.string().optional().describe("Filter by e-mail address."),
    exact: z
      .boolean()
      .optional()
      .describe("If true, `username`/`email`/`search` must match exactly instead of by prefix."),
    ...paginationShape,
  }),
  output: pageOf(userSummary).extend({ realm: z.string().describe("Realm that was searched.") }),
  async handler({ realm, search, username, email, exact, first, max }, { gateway }) {
    const rows = await gateway.run((kc) =>
      kc.users.find({
        realm,
        first,
        max: max + 1,
        briefRepresentation: true,
        ...(search !== undefined && { search }),
        ...(username !== undefined && { username }),
        ...(email !== undefined && { email }),
        ...(exact !== undefined && { exact }),
      }),
    );
    const page = toPage(rows.map(toUserSummary), first, max);
    return {
      data: { ...page, realm },
      summary: `Found ${page.items.length} user(s) in realm '${realm}' (first=${first}, max=${max}${page.hasMore ? ", more available" : ""}).`,
    };
  },
});

const userCreate = defineTool({
  name: "user_create",
  title: "Create user",
  description:
    "Create a new user in a realm. The user is enabled by default and has no credentials; use a separate flow to set a password or send required actions. Requires confirm: true after the user approved the preview.",
  kind: "sensitive",
  idempotent: false,
  input: z.object({
    realm: realmField,
    username: z.string().min(1).describe("Unique login name."),
    email: z.email().optional().describe("E-mail address."),
    firstName: z.string().optional().describe("First name."),
    lastName: z.string().optional().describe("Last name."),
    enabled: z.boolean().default(true).describe("Whether the user can log in (default true)."),
    emailVerified: z.boolean().optional().describe("Mark the e-mail address as verified."),
  }),
  output: z.object({
    id: z.string().describe("ID of the created user."),
    username: z.string().describe("Username of the created user."),
    realm: z.string().describe("Realm the user was created in."),
  }),
  preview({ realm, username, email, firstName, lastName, enabled, emailVerified }) {
    const details = [
      enabled ? "enabled" : "disabled",
      ...(email !== undefined
        ? [`e-mail ${quoted(email)}${emailVerified === true ? " marked as verified" : ""}`]
        : []),
      ...(firstName !== undefined ? [`first name ${quoted(firstName)}`] : []),
      ...(lastName !== undefined ? [`last name ${quoted(lastName)}`] : []),
    ];
    return `create user ${quoted(username)} (${details.join(", ")}) in realm '${realm}'.`;
  },
  async handler(
    { realm, username, email, firstName, lastName, enabled, emailVerified },
    { gateway },
  ) {
    const created = await gateway.run((kc) =>
      kc.users.create({
        realm,
        username,
        enabled,
        ...(email !== undefined && { email }),
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(emailVerified !== undefined && { emailVerified }),
      }),
    );
    return {
      data: { id: created.id, username, realm },
      summary: `Created user '${username}' (id ${created.id}) in realm '${realm}'.`,
    };
  },
});

const userDelete = defineTool({
  name: "user_delete",
  title: "Delete user",
  description:
    "Permanently delete a user from a realm. This cannot be undone. Requires confirm: true (ask the user first).",
  kind: "destructive",
  input: z.object({
    realm: realmField,
    userId: z.string().min(1).describe("ID (UUID) of the user to delete, e.g. from user_search."),
  }),
  output: z.object({
    deleted: z.boolean().describe("True if the user was deleted."),
    userId: z.string().describe("ID of the deleted user."),
    realm: z.string().describe("Realm the user was deleted from."),
  }),
  async preview({ realm, userId }, { gateway, config }) {
    return gateway.run(async (kc) => {
      const user = await requireUser(kc, realm, userId);
      return ownAccountPreview(
        kc,
        config,
        realm,
        user,
        `permanently delete user ${quoted(user.username ?? userId)} (id ${userId}) from realm '${realm}'.`,
      );
    });
  },
  async handler({ realm, userId }, { gateway }) {
    await gateway.run((kc) => kc.users.del({ realm, id: userId }));
    return {
      data: { deleted: true, userId, realm },
      summary: `Deleted user ${userId} from realm '${realm}'.`,
    };
  },
});

/** Detail view used by user_get and the user resource: summary plus non-sensitive metadata. */
type UserDetailRep = UserRep & {
  createdTimestamp?: number;
  requiredActions?: string[];
  totp?: boolean;
  federationLink?: string;
};

export function toUserDetails(user: UserDetailRep) {
  return {
    ...toUserSummary(user),
    ...(user.createdTimestamp !== undefined && { createdTimestamp: user.createdTimestamp }),
    ...(user.requiredActions !== undefined && { requiredActions: user.requiredActions }),
    ...(user.totp !== undefined && { totp: user.totp }),
    ...(user.federationLink !== undefined && { federationLink: user.federationLink }),
  };
}

const userGet = defineTool({
  name: "user_get",
  title: "Get user",
  description:
    "Get one user by ID with a safe subset of fields (no attributes, no credentials). Use user_search to find the ID.",
  kind: "read",
  input: z.object({
    realm: realmField,
    userId: z.string().min(1).describe("ID (UUID) of the user, e.g. from user_search."),
  }),
  output: userSummary.extend({
    createdTimestamp: z.number().optional().describe("Creation time in epoch milliseconds."),
    requiredActions: z.array(z.string()).optional().describe("Pending required actions."),
    totp: z.boolean().optional().describe("Whether the user has OTP configured."),
    federationLink: z.string().optional().describe("ID of the federation provider, if any."),
  }),
  async handler({ realm, userId }, { gateway }) {
    const user = await gateway.run((kc) => kc.users.findOne({ realm, id: userId }));
    if (!user)
      throw new ToolError("not_found", `User ${userId} does not exist in realm '${realm}'.`);
    return {
      data: toUserDetails(user),
      summary: `Returned user ${userId} from realm '${realm}'.`,
    };
  },
});

interface UserChanges {
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  enabled?: boolean | undefined;
  emailVerified?: boolean | undefined;
  requiredActions?: string[] | undefined;
}

/**
 * The partial representation user_update sends: only the given fields. A new
 * e-mail address is marked as unverified unless `emailVerified` is given.
 */
function plannedUpdate(current: UserRep, changes: UserChanges): Record<string, unknown> {
  const update: Record<string, unknown> = Object.fromEntries(
    Object.entries(changes).filter(([, v]) => v !== undefined),
  );
  const emailChanged =
    changes.email !== undefined &&
    changes.email.toLowerCase() !== (current.email ?? "").toLowerCase();
  if (emailChanged && changes.emailVerified === undefined) update.emailVerified = false;
  return update;
}

function previewValue(value: unknown): string {
  if (value === undefined || value === null) return "(unset)";
  if (typeof value === "string") return quoted(value);
  if (Array.isArray(value)) return `[${value.map((v) => quoted(String(v))).join(", ")}]`;
  return String(value);
}

const userUpdate = defineTool({
  name: "user_update",
  title: "Update user",
  description:
    "Update selected fields of a user (partial update; only the given fields are sent, everything else stays unchanged). At least one field besides realm and userId is required. Setting `requiredActions` replaces the existing list. Changing `email` marks the address as unverified unless `emailVerified` is given. Requires confirm: true after the user approved the preview, which names the old and new values and whether the account has administrative rights. The account this server signs in with cannot be changed.",
  kind: "sensitive",
  idempotent: true,
  input: z.object({
    realm: realmField,
    userId: z.string().min(1).describe("ID (UUID) of the user to update."),
    email: z
      .email()
      .optional()
      .describe("New e-mail address. Marks the address as unverified unless emailVerified is set."),
    firstName: z.string().optional().describe("New first name."),
    lastName: z.string().optional().describe("New last name."),
    enabled: z.boolean().optional().describe("Enable or disable the user."),
    emailVerified: z.boolean().optional().describe("Mark the e-mail as verified or not."),
    requiredActions: z
      .array(z.string().min(1))
      .optional()
      .describe("Required actions to set, e.g. UPDATE_PASSWORD (replaces the existing list)."),
  }),
  output: z.object({
    userId: z.string().describe("ID of the updated user."),
    realm: z.string().describe("Realm of the user."),
    updatedFields: z
      .array(z.string())
      .describe("Names of the fields that were set, including emailVerified when it was reset."),
  }),
  async preview({ realm, userId, ...changes }, { gateway, config }) {
    if (Object.values(changes).every((v) => v === undefined))
      throw new ToolError("bad_request", "Provide at least one field to update.");
    return gateway.run(async (kc) => {
      const current = await requireUser(kc, realm, userId);
      assertNotOwnAccount(kc, config, realm, current, "change");
      const update = plannedUpdate(current, changes);
      const fields = Object.entries(update).map(
        ([key, value]) =>
          `${key} ${previewValue((current as Record<string, unknown>)[key])} -> ${previewValue(value)}`,
      );
      const rights = await adminRightsOfUser(kc, realm, userId);
      return `update user ${quoted(current.username ?? userId)} (id ${userId}) in realm '${realm}': ${fields.join(", ")}.${targetRightsNote(rights)}`;
    });
  },
  async handler({ realm, userId, ...changes }, { gateway }) {
    const update = await gateway.run(async (kc) => {
      const current = await requireUser(kc, realm, userId);
      const update = plannedUpdate(current, changes);
      // Only the changed fields: Keycloak keeps everything that is not sent,
      // so concurrent changes to other fields and attributes are not overwritten.
      await kc.users.update({ realm, id: userId }, update);
      return update;
    });
    const updatedFields = Object.keys(update);
    const reset = update.emailVerified === false && changes.emailVerified === undefined;
    return {
      data: { userId, realm, updatedFields },
      summary: `Updated ${updatedFields.length} field(s) of user ${userId} in realm '${realm}'${reset ? "; the new e-mail address is marked as unverified" : ""}.`,
    };
  },
});

const userSendActionsEmail = defineTool({
  name: "user_send_actions_email",
  title: "Send required-actions e-mail",
  description:
    "Send the user an e-mail with a link to perform required actions (e.g. update password, verify e-mail). Whoever controls the e-mail address can use the link, so this requires confirm: true after the user approved the preview, which names the recipient address. Each call sends another e-mail. Requires SMTP to be configured in the realm and the user to have an e-mail address. The account this server signs in with cannot be targeted.",
  kind: "sensitive",
  idempotent: false,
  input: z.object({
    realm: realmField,
    userId: z.string().min(1).describe("ID (UUID) of the user to e-mail."),
    actions: z
      .array(
        z.enum([
          "UPDATE_PASSWORD",
          "VERIFY_EMAIL",
          "CONFIGURE_TOTP",
          "UPDATE_PROFILE",
          "TERMS_AND_CONDITIONS",
        ]),
      )
      .min(1)
      .describe("Actions the user must perform via the e-mailed link."),
    lifespan: z
      .number()
      .int()
      .min(1)
      .max(MAX_ACTIONS_EMAIL_LIFESPAN)
      .optional()
      .describe(
        `Link validity in seconds, at most ${MAX_ACTIONS_EMAIL_LIFESPAN} (24 hours). If omitted, the realm's setting for admin-initiated action links applies.`,
      ),
    clientId: z
      .string()
      .min(1)
      .optional()
      .describe("Client ID used for the redirect after the actions."),
    redirectUri: z
      .string()
      .min(1)
      .optional()
      .describe("Redirect URI after the actions; requires clientId."),
  }),
  output: z.object({
    sent: z.boolean().describe("True if Keycloak accepted the e-mail request."),
    userId: z.string().describe("ID of the user."),
    realm: z.string().describe("Realm of the user."),
    actions: z.array(z.string()).describe("Actions requested in the e-mail."),
  }),
  async preview({ realm, userId, actions, lifespan, clientId, redirectUri }, { gateway, config }) {
    return gateway.run(async (kc) => {
      const user = await requireUser(kc, realm, userId);
      assertNotOwnAccount(kc, config, realm, user, "send action e-mails for");
      const recipient =
        user.email === undefined || user.email === ""
          ? "user without e-mail address (Keycloak will reject the request)"
          : quoted(user.email);
      const validity =
        lifespan === undefined
          ? "the realm's default validity"
          : `a link valid for ${lifespan} second(s)`;
      const redirect =
        redirectUri === undefined
          ? ""
          : `, redirecting to ${quoted(redirectUri)} afterwards (client ${quoted(clientId ?? "")})`;
      const rights = await adminRightsOfUser(kc, realm, userId);
      return `send an e-mail to ${recipient} asking user ${quoted(user.username ?? userId)} (id ${userId}) in realm '${realm}' to perform ${actions.join(", ")}, with ${validity}${redirect}.${targetRightsNote(rights)}`;
    });
  },
  async handler({ realm, userId, actions, lifespan, clientId, redirectUri }, { gateway }) {
    await gateway.run((kc) =>
      kc.users.executeActionsEmail({
        realm,
        id: userId,
        actions,
        ...(lifespan !== undefined && { lifespan }),
        ...(clientId !== undefined && { clientId }),
        ...(redirectUri !== undefined && { redirectUri }),
      }),
    );
    return {
      data: { sent: true, userId, realm, actions },
      summary: `Requested actions e-mail (${actions.join(", ")}) for user ${userId} in realm '${realm}'.`,
    };
  },
});

export const userTools = [
  userSearch,
  userGet,
  userCreate,
  userUpdate,
  userDelete,
  userSendActionsEmail,
];
