import type KcAdminClient from "@keycloak/keycloak-admin-client";
import type { Config } from "../config.js";
import { httpStatusOf, ToolError } from "../keycloak/errors.js";
import { type Preview, type PreviewResult, quoted } from "./shared.js";

// ---------------------------------------------------------------------------
// Administrative roles
// ---------------------------------------------------------------------------

/**
 * Roles that grant administrative power over a realm. `realm` is the realm the
 * role lives in: in `master`, the `<realm>-realm` clients hold the admin roles
 * of every realm.
 */
export function isPrivilegedRole(
  name: string,
  clientId: string | undefined,
  realm?: string,
): boolean {
  if (clientId === undefined) return name === "admin" || name === "create-realm";
  if (clientId === "realm-management") return true;
  if (realm?.toLowerCase() === "master" && clientId.endsWith("-realm")) return true;
  return (
    name === "realm-admin" ||
    name === "impersonation" ||
    name === "create-client" ||
    name.startsWith("manage-")
  );
}

/** Used when the client of a role is not visible: any realm-management role name counts. */
function looksLikeAdminRole(name: string): boolean {
  return (
    name === "realm-admin" ||
    name === "impersonation" ||
    name === "create-client" ||
    /^(manage|view|query)-/.test(name)
  );
}

// ---------------------------------------------------------------------------
// Effective administrative rights
// ---------------------------------------------------------------------------

export interface RoleRef {
  id?: string;
  name?: string;
  composite?: boolean;
  clientRole?: boolean;
  /** Internal id of the realm (realm roles) or client (client roles). */
  containerId?: string;
}

type ClientMappings = Record<string, { id?: string; client?: string; mappings?: RoleRef[] }>;

interface RoleMappings {
  realmMappings?: RoleRef[];
  clientMappings?: ClientMappings | Record<string, unknown>;
}

interface GroupRef {
  id?: string;
  name?: string;
  path?: string;
  parentId?: string;
}

export interface AdminGrant {
  /** `name` for realm roles, `clientId/name` for client roles. */
  role: string;
  /** Where the role comes from, outermost first, e.g. `group "/admins"`, `role "helpdesk"`. */
  via: string[];
}

export interface AdminRights {
  grants: AdminGrant[];
  /**
   * False when Keycloak may have hidden roles from this server's account (it
   * filters client roles the account cannot view), so an empty `grants` list
   * proves nothing.
   */
  verified: boolean;
}

/** Upper bound for composite roles expanded in one check. */
const MAX_EXPANDED_ROLES = 500;
const MAX_USER_GROUPS = 1000;

function isHidden(error: unknown): boolean {
  if (error instanceof ToolError) return error.kind === "forbidden" || error.kind === "not_found";
  const status = httpStatusOf(error);
  return status === 403 || status === 404;
}

/**
 * Resolves roles, groups and parent groups down to the administrative roles
 * they grant, including roles inside composite roles (with cycle protection).
 */
class AdminRightsScanner {
  private readonly kc: KcAdminClient;
  private readonly realm: string;
  private readonly grants = new Map<string, AdminGrant>();
  private readonly clientIds = new Map<string, string | undefined>();
  private readonly expanded = new Set<string>();
  private readonly groupsSeen = new Set<string>();
  private fullView: Promise<boolean> | undefined;
  private verified = true;

  constructor(kc: KcAdminClient, realm: string) {
    this.kc = kc;
    this.realm = realm;
  }

  result(): AdminRights {
    return { grants: [...this.grants.values()], verified: this.verified };
  }

  /**
   * Whether this account sees all client roles. Without view-clients, Keycloak
   * answers 403 or silently leaves client roles out of mappings and composites.
   */
  private hasFullView(): Promise<boolean> {
    this.fullView ??= (async () => {
      const adminClient =
        this.realm.toLowerCase() === "master" ? "master-realm" : "realm-management";
      try {
        const found =
          (await this.kc.clients.find({ realm: this.realm, clientId: adminClient })) ?? [];
        const match = found.find((c) => c.clientId === adminClient);
        if (match?.id) this.clientIds.set(match.id, adminClient);
        return match?.id !== undefined;
      } catch (error) {
        if (isHidden(error)) return false;
        throw error;
      }
    })();
    return this.fullView;
  }

  /** Marks the result as unverified unless all client roles are visible. */
  private async requireFullView(): Promise<void> {
    if (!(await this.hasFullView())) this.verified = false;
  }

  private async clientIdOf(containerId: string | undefined): Promise<string | undefined> {
    if (containerId === undefined) return undefined;
    if (this.clientIds.has(containerId)) return this.clientIds.get(containerId);
    let clientId: string | undefined;
    try {
      clientId = (await this.kc.clients.findOne({ realm: this.realm, id: containerId }))?.clientId;
    } catch (error) {
      if (!isHidden(error)) throw error;
    }
    this.clientIds.set(containerId, clientId);
    return clientId;
  }

  /** `clientId` must be given for client roles when known; undefined means "not visible". */
  async addRole(
    role: RoleRef,
    clientId: string | undefined,
    via: readonly string[],
  ): Promise<void> {
    const name = role.name ?? "";
    const label =
      role.clientRole !== true ? name : clientId === undefined ? name : `${clientId}/${name}`;
    const privileged =
      role.clientRole !== true
        ? isPrivilegedRole(name, undefined, this.realm)
        : clientId === undefined
          ? looksLikeAdminRole(name)
          : isPrivilegedRole(name, clientId, this.realm);
    if (privileged) {
      if (!this.grants.has(label)) this.grants.set(label, { role: label, via: [...via] });
      return;
    }
    if (role.composite !== true) return;
    // Keycloak may leave invisible client roles out of the composites list.
    await this.requireFullView();
    if (role.id === undefined || this.expanded.size >= MAX_EXPANDED_ROLES) {
      this.verified = false;
      return;
    }
    if (this.expanded.has(role.id)) return;
    this.expanded.add(role.id);
    let children: RoleRef[];
    try {
      children = (await this.kc.roles.getCompositeRoles({ realm: this.realm, id: role.id })) ?? [];
    } catch (error) {
      if (!isHidden(error)) throw error;
      this.verified = false;
      return;
    }
    const next = [...via, `role ${quoted(label)}`];
    for (const child of children) {
      const childClient =
        child.clientRole === true ? await this.clientIdOf(child.containerId) : undefined;
      await this.addRole(child, childClient, next);
    }
  }

  async addMappings(mappings: RoleMappings | undefined, via: readonly string[]): Promise<void> {
    // Mappings can be filtered just like composites.
    await this.requireFullView();
    for (const role of mappings?.realmMappings ?? []) await this.addRole(role, undefined, via);
    const clients = (mappings?.clientMappings ?? {}) as ClientMappings;
    for (const [key, entry] of Object.entries(clients)) {
      const clientId = entry.client ?? key;
      if (entry.id !== undefined) this.clientIds.set(entry.id, clientId);
      for (const role of entry.mappings ?? []) {
        await this.addRole({ ...role, clientRole: true }, clientId, via);
      }
    }
  }

  /** Adds the role mappings of `group` and of all its parent groups. */
  async addGroup(group: GroupRef): Promise<void> {
    let current: GroupRef | undefined = group;
    while (current?.id !== undefined && !this.groupsSeen.has(current.id)) {
      const id: string = current.id;
      this.groupsSeen.add(id);
      let mappings: RoleMappings | undefined;
      try {
        mappings = await this.kc.groups.listRoleMappings({ realm: this.realm, id });
      } catch (error) {
        if (!isHidden(error)) throw error;
        this.verified = false;
      }
      await this.addMappings(mappings, [`group ${quoted(current.path ?? current.name ?? id)}`]);
      if (current.parentId === undefined) {
        // Keycloak versions without parentId: a nested path means unknown parents.
        if ((current.path ?? "").split("/").length > 2) this.verified = false;
        return;
      }
      current = await this.kc.groups.findOne({ realm: this.realm, id: current.parentId });
      if (current === undefined) this.verified = false;
    }
  }

  /** Direct role mappings of a user plus everything inherited through groups. */
  async addUser(userId: string): Promise<void> {
    await this.addMappings(
      await this.kc.users.listRoleMappings({ realm: this.realm, id: userId }),
      [],
    );
    const groups =
      (await this.kc.users.listGroups({
        realm: this.realm,
        id: userId,
        briefRepresentation: false,
        max: MAX_USER_GROUPS,
      })) ?? [];
    if (groups.length >= MAX_USER_GROUPS) this.verified = false;
    for (const group of groups) await this.addGroup(group);
  }
}

/** Administrative rights a user would get from these roles (`clientId` undefined for realm roles). */
export async function adminRightsOfRoles(
  kc: KcAdminClient,
  realm: string,
  roles: readonly RoleRef[],
  clientId: string | undefined,
): Promise<AdminRights> {
  const scanner = new AdminRightsScanner(kc, realm);
  for (const role of roles) {
    await scanner.addRole({ ...role, clientRole: clientId !== undefined }, clientId, []);
  }
  return scanner.result();
}

/** Administrative rights a member of `group` gets, including from parent groups. */
export async function adminRightsOfGroup(
  kc: KcAdminClient,
  realm: string,
  group: GroupRef,
): Promise<AdminRights> {
  const scanner = new AdminRightsScanner(kc, realm);
  await scanner.addGroup(group);
  return scanner.result();
}

/** Administrative rights a user currently has, directly, via composites or via groups. */
export async function adminRightsOfUser(
  kc: KcAdminClient,
  realm: string,
  userId: string,
): Promise<AdminRights> {
  const scanner = new AdminRightsScanner(kc, realm);
  await scanner.addUser(userId);
  return scanner.result();
}

function describeGrants(grants: readonly AdminGrant[]): string {
  return grants
    .map((g) => `${quoted(g.role)}${g.via.length > 0 ? ` via ${g.via.join(" > ")}` : ""}`)
    .join(", ");
}

const VIEW_CLIENTS_HINT =
  "Keycloak hides some roles from this server's account (the check needs the realm-management role view-clients)";

/**
 * Preview for a grant (role assignment, group membership). Administrative or
 * uncheckable grants need a confirmation that cannot be turned off.
 */
export function grantPreview(text: string, rights: AdminRights): PreviewResult {
  if (rights.grants.length > 0) {
    return {
      text: `${text} This grants administrative rights: ${describeGrants(rights.grants)}.`,
      unconditional: true,
    };
  }
  if (!rights.verified) {
    return {
      text: `${text} It could not be ruled out that this grants administrative rights: ${VIEW_CLIENTS_HINT}. Treat it as an administrative grant.`,
      unconditional: true,
    };
  }
  return text;
}

/** Sentence for previews of changes to an existing account. */
export function targetRightsNote(rights: AdminRights): string {
  if (rights.grants.length > 0) {
    return ` The target account has administrative rights: ${describeGrants(rights.grants)}.`;
  }
  if (!rights.verified) {
    return ` Whether the target account has administrative rights could not be checked: ${VIEW_CLIENTS_HINT}.`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// The server's own account
// ---------------------------------------------------------------------------

export interface OwnAccount {
  /** `sub` of the access token: the user id of the service account or admin user. */
  id?: string;
  /** `preferred_username`; only used when the token carries no `sub`. */
  username?: string;
}

/** Identity of the account this server signs in with, read from its current access token. */
export function ownAccountOf(kc: KcAdminClient): OwnAccount {
  const token: unknown = kc.accessToken;
  if (typeof token !== "string") return {};
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return {
      ...(typeof claims.sub === "string" && claims.sub !== "" && { id: claims.sub }),
      ...(typeof claims.preferred_username === "string" && {
        username: claims.preferred_username,
      }),
    };
  } catch {
    return {};
  }
}

/** True if `user` (in `realm`) is the account this server signs in with. */
export function isOwnAccount(
  kc: KcAdminClient,
  config: Pick<Config, "authRealm">,
  realm: string,
  user: { id?: string; username?: string },
): boolean {
  const own = ownAccountOf(kc);
  // User ids are unique across realms, so the id alone decides.
  if (own.id !== undefined) return user.id === own.id;
  return (
    own.username !== undefined &&
    user.username !== undefined &&
    realm.toLowerCase() === config.authRealm.toLowerCase() &&
    user.username.toLowerCase() === own.username.toLowerCase()
  );
}

/** Rejects changes that would let the server extend or take over its own account. */
export function assertNotOwnAccount(
  kc: KcAdminClient,
  config: Pick<Config, "authRealm">,
  realm: string,
  user: { id?: string; username?: string },
  action: string,
): void {
  if (isOwnAccount(kc, config, realm, user)) {
    throw new ToolError(
      "guard",
      `Refusing to ${action} the account this server signs in with (user ${user.id ?? "?"}). Make such changes in the Keycloak admin console. Nothing was changed.`,
    );
  }
}

/** Marks a preview whose target is the server's own account; its confirmation cannot be turned off. */
export function ownAccountPreview(
  kc: KcAdminClient,
  config: Pick<Config, "authRealm">,
  realm: string,
  user: { id?: string; username?: string },
  text: string,
): PreviewResult {
  if (!isOwnAccount(kc, config, realm, user)) return text;
  const preview: Preview = {
    text: `${text} This is the account this server signs in with.`,
    unconditional: true,
  };
  return preview;
}

/** Loads a user or fails with not_found. */
export async function requireUser(kc: KcAdminClient, realm: string, userId: string) {
  const user = await kc.users.findOne({ realm, id: userId });
  if (!user) throw new ToolError("not_found", `User ${userId} does not exist in realm '${realm}'.`);
  return { ...user, id: user.id ?? userId };
}
