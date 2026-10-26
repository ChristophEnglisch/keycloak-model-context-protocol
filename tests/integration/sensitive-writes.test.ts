import { randomUUID } from "node:crypto";
import type KcAdminClient from "@keycloak/keycloak-admin-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  createServiceAccount,
  createUser,
  deleteClient,
  deleteUsersByPrefix,
  findUserId,
  type ServiceAccount,
} from "./helpers/admin.js";
import { CLIENTS, REALM, USERS } from "./helpers/constants.js";
import { describeIt } from "./helpers/context.js";
import { type RealServer, serviceAccountEnv, startRealServer, textOf } from "./helpers/server.js";

const PREFIX = "sw";
const NO_CONFIRMATION = { KEYCLOAK_MCP_REQUIRE_CONFIRMATION: "false" };

async function roleRef(kc: KcAdminClient, realm: string, clientId: string, roleName: string) {
  const [client] = await kc.clients.find({ realm, clientId });
  const role = await kc.clients.findRole({ realm, id: client?.id as string, roleName });
  return { id: role?.id as string, name: roleName };
}

async function realmRoleNames(kc: KcAdminClient, realm: string, userId: string) {
  return (await kc.users.listCompositeRealmRoleMappings({ realm, id: userId })).map((r) => r.name);
}

/**
 * Administrative grants through composite roles and parent groups, and the
 * protection of the server's own account, against a real Keycloak.
 */
describeIt("sensitive writes against a real Keycloak", () => {
  const suffix = randomUUID().slice(0, 6);
  const names = {
    helpdesk: `sw-helpdesk-${suffix}`,
    support: `sw-support-${suffix}`,
    superuser: `sw-super-${suffix}`,
    admins: `sw-admins-${suffix}`,
  };
  const accounts: ServiceAccount[] = [];
  const servers: RealServer[] = [];
  let full: ServiceAccount;
  let limited: ServiceAccount;
  let subGroupId: string;
  let opsGroupId: string;
  let adminsGroupId: string;

  async function server(account: ServiceAccount, extra: Record<string, string> = {}) {
    const s = await startRealServer(
      serviceAccountEnv(REALM, account.clientId, account.secret),
      extra,
    );
    servers.push(s);
    return s;
  }

  async function serviceUserId(account: ServiceAccount): Promise<string> {
    const kc = await adminClient();
    const user = await kc.clients.getServiceAccountUser({ realm: REALM, id: account.id });
    return user.id as string;
  }

  beforeAll(async () => {
    const kc = await adminClient();
    const realmAdmin = await roleRef(kc, REALM, "realm-management", "realm-admin");
    const manageRealm = await roleRef(kc, REALM, "realm-management", "manage-realm");

    // support -> helpdesk -> realm-management/realm-admin
    await kc.roles.create({ realm: REALM, name: names.helpdesk });
    await kc.roles.create({ realm: REALM, name: names.support });
    const helpdesk = await kc.roles.findOneByName({ realm: REALM, name: names.helpdesk });
    const support = await kc.roles.findOneByName({ realm: REALM, name: names.support });
    await kc.roles.createComposite({ realm: REALM, roleId: helpdesk?.id as string }, [realmAdmin]);
    await kc.roles.createComposite({ realm: REALM, roleId: support?.id as string }, [
      { id: helpdesk?.id as string, name: names.helpdesk },
    ]);

    // it-app/superuser -> realm-management/manage-realm
    const [app] = await kc.clients.find({ realm: REALM, clientId: CLIENTS.app.clientId });
    await kc.clients.createRole({ realm: REALM, id: app?.id as string, name: names.superuser });
    const superuser = await kc.clients.findRole({
      realm: REALM,
      id: app?.id as string,
      roleName: names.superuser,
    });
    await kc.roles.createComposite({ realm: REALM, roleId: superuser?.id as string }, [
      manageRealm,
    ]);

    // /admins (realm-admin) with the child /admins/sub (no roles of its own)
    const admins = await kc.groups.create({ realm: REALM, name: names.admins });
    adminsGroupId = admins.id;
    const [rm] = await kc.clients.find({ realm: REALM, clientId: "realm-management" });
    await kc.groups.addClientRoleMappings({
      realm: REALM,
      id: admins.id,
      clientUniqueId: rm?.id as string,
      roles: [realmAdmin],
    });
    const sub = await kc.groups.createChildGroup({ realm: REALM, id: admins.id }, { name: "sub" });
    subGroupId = sub.id;
    const [ops] = await kc.groups.find({ realm: REALM, search: "ops", exact: true });
    opsGroupId = ops?.id as string;

    full = await createServiceAccount(REALM, ["manage-users", "view-realm", "view-clients"]);
    limited = await createServiceAccount(REALM, ["manage-users", "view-realm"]);
    accounts.push(full, limited);
  });

  afterAll(async () => {
    for (const s of servers) await s.close();
    for (const a of accounts) await deleteClient(a.realm, a.id);
    const kc = await adminClient();
    await kc.groups.del({ realm: REALM, id: adminsGroupId });
    await kc.roles.delByName({ realm: REALM, name: names.support });
    await kc.roles.delByName({ realm: REALM, name: names.helpdesk });
    const [app] = await kc.clients.find({ realm: REALM, clientId: CLIENTS.app.clientId });
    await kc.clients.delRole({ realm: REALM, id: app?.id as string, roleName: names.superuser });
    await deleteUsersByPrefix(REALM, PREFIX);
  });

  describe("user_role_assign", () => {
    it("finds realm-admin inside nested composite realm roles, even with confirmation off", async () => {
      const s = await server(full, NO_CONFIRMATION);
      const { id } = await createUser(REALM, PREFIX);
      const result = await s.call("user_role_assign", {
        realm: REALM,
        userId: id,
        roles: [names.support],
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(
        `This grants administrative rights: "realm-management/realm-admin" via role "${names.support}" > role "${names.helpdesk}".`,
      );
      expect(textOf(result)).toContain("cannot be turned off");
      expect(await realmRoleNames(await adminClient(), REALM, id)).not.toContain(names.support);
    });

    it("finds an admin role inside a composite client role", async () => {
      const s = await server(full);
      const { id } = await createUser(REALM, PREFIX);
      const result = await s.call("user_role_assign", {
        realm: REALM,
        userId: id,
        clientId: CLIENTS.app.clientId,
        roles: [names.superuser],
      });
      expect(textOf(result)).toContain(
        `"realm-management/manage-realm" via role "${CLIENTS.app.clientId}/${names.superuser}"`,
      );
    });

    it("assigns an ordinary composite role without extra confirmation when confirmation is off", async () => {
      const s = await server(full, NO_CONFIRMATION);
      const { id } = await createUser(REALM, PREFIX);
      const result = await s.call("user_role_assign", {
        realm: REALM,
        userId: id,
        roles: ["composite-role"],
      });
      expect(result.isError, textOf(result)).not.toBe(true);
      expect(await realmRoleNames(await adminClient(), REALM, id)).toContain("composite-role");
    });

    it("without view-clients still demands a confirmation that cannot be turned off", async () => {
      const s = await server(limited, NO_CONFIRMATION);
      const { id } = await createUser(REALM, PREFIX);
      const result = await s.call("user_role_assign", {
        realm: REALM,
        userId: id,
        roles: [names.support],
      });
      expect(result.isError).toBe(true);
      // Keycloak 26.8 hides the client role, older versions show it.
      expect(textOf(result)).toMatch(/administrative rights/);
      expect(textOf(result)).toContain("cannot be turned off");
      expect(await realmRoleNames(await adminClient(), REALM, id)).not.toContain(names.support);
    });
  });

  describe("user_group_add", () => {
    it("finds realm-admin inherited from the parent group, even with confirmation off", async () => {
      const s = await server(full, NO_CONFIRMATION);
      const { id } = await createUser(REALM, PREFIX);
      const result = await s.call("user_group_add", {
        realm: REALM,
        userId: id,
        groupId: subGroupId,
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(`to group "/${names.admins}/sub"`);
      expect(textOf(result)).toContain(
        `This grants administrative rights: "realm-management/realm-admin" via group "/${names.admins}".`,
      );
      const kc = await adminClient();
      expect(await kc.users.listGroups({ realm: REALM, id })).toHaveLength(0);
    });

    it("adds to a group without administrative roles when confirmation is off", async () => {
      const s = await server(full, NO_CONFIRMATION);
      const { id } = await createUser(REALM, PREFIX);
      const result = await s.call("user_group_add", {
        realm: REALM,
        userId: id,
        groupId: opsGroupId,
      });
      expect(result.isError, textOf(result)).not.toBe(true);
    });

    it("without view-clients cannot rule out administrative rights", async () => {
      const s = await server(limited, NO_CONFIRMATION);
      const { id } = await createUser(REALM, PREFIX);
      const result = await s.call("user_group_add", {
        realm: REALM,
        userId: id,
        groupId: opsGroupId,
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/could not be ruled out.*view-clients/s);
    });
  });

  describe("the server's own account", () => {
    it.each([
      ["user_role_assign", { roles: ["editor"] }],
      ["user_group_add", { groupId: "OPS" }],
      ["user_update", { email: "attacker@evil.example" }],
      ["user_send_actions_email", { actions: ["UPDATE_PASSWORD"] }],
    ])("rejects %s for its own service-account user", async (tool, extra) => {
      const s = await server(full, NO_CONFIRMATION);
      const ownId = await serviceUserId(full);
      const args = { realm: REALM, userId: ownId, ...extra, confirm: true } as Record<
        string,
        unknown
      >;
      if (args.groupId === "OPS") args.groupId = opsGroupId;
      const result = await s.call(tool, args);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/Refusing to .* the account this server signs in with/);
      const kc = await adminClient();
      expect(await realmRoleNames(kc, REALM, ownId)).not.toContain("editor");
      expect(await kc.users.listGroups({ realm: REALM, id: ownId })).toHaveLength(0);
    });
  });

  it("names the administrative rights of the target account", async () => {
    const s = await server(full);
    const adminId = await findUserId(REALM, USERS.admin.username);
    const result = await s.call("user_update", { realm: REALM, userId: adminId, enabled: true });
    expect(textOf(result)).toContain(
      'The target account has administrative rights: "realm-management/realm-admin".',
    );
  });
});

/**
 * user_update sends only the changed fields. Runs in its own realm with a
 * declarative user profile (a managed custom attribute) and unmanaged attributes.
 */
describeIt("user_update against a real Keycloak", () => {
  const realm = `sw-profile-${randomUUID().slice(0, 6)}`;
  let s: RealServer;
  let userId: string;

  async function current() {
    const kc = await adminClient();
    return kc.users.findOne({ realm, id: userId });
  }

  beforeAll(async () => {
    const kc = await adminClient();
    await kc.realms.create({ realm, enabled: true });
    const profile = await kc.users.getProfile({ realm });
    profile.attributes = [
      ...(profile.attributes ?? []),
      {
        name: "department",
        displayName: "Department",
        permissions: { view: ["admin"], edit: ["admin"] },
      },
    ];
    // The enum is not exported by the admin client.
    profile.unmanagedAttributePolicy = "ENABLED" as typeof profile.unmanagedAttributePolicy;
    await kc.users.updateProfile({ realm, ...profile });
    ({ id: userId } = await kc.users.create({
      realm,
      username: "target",
      email: "target@example.test",
      emailVerified: true,
      firstName: "Tara",
      lastName: "Get",
      enabled: true,
      requiredActions: ["CONFIGURE_TOTP"],
      attributes: { department: ["IT"], custom: ["kept"] },
    }));
    const account = await createServiceAccount(realm, ["manage-users"]);
    s = await startRealServer(serviceAccountEnv(realm, account.clientId, account.secret));
  });

  afterAll(async () => {
    await s?.close();
    const kc = await adminClient();
    await kc.realms.del({ realm });
  });

  it("previews old and new e-mail and resets emailVerified", async () => {
    const preview = await s.call("user_update", { realm, userId, email: "new@example.test" });
    expect(preview.isError).toBe(true);
    expect(textOf(preview)).toContain(
      'email "target@example.test" -> "new@example.test", emailVerified true -> false',
    );
    expect((await current())?.email).toBe("target@example.test");
  });

  it("marks a changed e-mail as unverified and keeps everything else", async () => {
    const result = await s.ok<{ updatedFields: string[] }>("user_update", {
      realm,
      userId,
      email: "new@example.test",
      confirm: true,
    });
    expect(result.updatedFields).toEqual(["email", "emailVerified"]);
    const user = await current();
    expect(user).toMatchObject({
      email: "new@example.test",
      emailVerified: false,
      firstName: "Tara",
      lastName: "Get",
      enabled: true,
      requiredActions: ["CONFIGURE_TOTP"],
    });
    expect(user?.attributes).toMatchObject({ department: ["IT"], custom: ["kept"] });
  });

  it("changes a single field without touching e-mail, attributes or required actions", async () => {
    await s.ok("user_update", { realm, userId, enabled: false, confirm: true });
    await s.ok("user_update", { realm, userId, lastName: "Changed", confirm: true });
    const user = await current();
    expect(user).toMatchObject({
      email: "new@example.test",
      emailVerified: false,
      firstName: "Tara",
      lastName: "Changed",
      enabled: false,
      requiredActions: ["CONFIGURE_TOTP"],
    });
    expect(user?.attributes).toMatchObject({ department: ["IT"], custom: ["kept"] });
  });

  it("keeps an explicitly given emailVerified", async () => {
    await s.ok("user_update", {
      realm,
      userId,
      email: "verified@example.test",
      emailVerified: true,
      confirm: true,
    });
    expect(await current()).toMatchObject({ email: "verified@example.test", emailVerified: true });
  });
});
