import { afterAll, beforeAll, expect, it } from "vitest";
import { TOOLSETS } from "../../src/tools/index.js";
import { deleteUsersByPrefix, findUserId, passwordLogin } from "./helpers/admin.js";
import { CLIENTS, REALM, REALM_B, USERS } from "./helpers/constants.js";
import { describeIt } from "./helpers/context.js";
import {
  masterAdminEnv,
  type Page,
  type RealServer,
  startRealServer,
  textOf,
} from "./helpers/server.js";

const PREFIX = "tools";

interface UserItem {
  id: string;
  username: string;
  [key: string]: unknown;
}

/**
 * Every tool at least once against a real Keycloak (in-memory MCP client, real gateway,
 * master admin). Order matters: later steps use users and ids from earlier ones.
 */
describeIt("all tools (happy path, master admin, in-memory client)", () => {
  let server: RealServer;
  let aliceId: string;
  let newUserId: string;
  let newUsername: string;
  let opsGroupId: string;
  const called = new Set<string>();

  const ok = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown>) => {
    called.add(name);
    return server.ok<T>(name, args);
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    called.add(name);
    return server.call(name, args);
  };

  beforeAll(async () => {
    server = await startRealServer(masterAdminEnv());
    aliceId = await findUserId(REALM, USERS.alice.username);
    newUsername = `${PREFIX}-${Date.now().toString(36)}`;
  });

  afterAll(async () => {
    await server?.close();
    await deleteUsersByPrefix(REALM, PREFIX);
  });

  it("lists all 24 tools with structured output schemas", async () => {
    const { tools } = await server.client.listTools();
    expect(tools).toHaveLength(24);
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
  });

  it("realm_list", async () => {
    const page = await ok<Page<{ realm: string }>>("realm_list", {});
    const names = page.items.map((r) => r.realm);
    expect(names).toEqual(expect.arrayContaining(["master", REALM, REALM_B]));
  });

  it("realm_get", async () => {
    const realm = await ok<{ realm: string; displayName?: string; bruteForceProtected?: boolean }>(
      "realm_get",
      { realm: REALM },
    );
    expect(realm.realm).toBe(REALM);
    expect(realm.displayName).toBe("Integration Test Realm");
    expect(realm.bruteForceProtected).toBe(true);
    expect(JSON.stringify(realm)).not.toMatch(/smtp|privateKey|secret/i);
  });

  it("user_search", async () => {
    const page = await ok<Page<UserItem>>("user_search", { realm: REALM, search: "alice" });
    expect(page.items.map((u) => u.username)).toContain("alice");
    const all = await ok<Page<UserItem>>("user_search", { realm: REALM, max: 2 });
    expect(all.items).toHaveLength(2);
    expect(all.hasMore).toBe(true);
    expect(JSON.stringify(all)).not.toContain("credentials");
  });

  it("user_create", async () => {
    const created = await ok<{ id: string; username: string; realm: string }>("user_create", {
      realm: REALM,
      username: newUsername,
      email: `${newUsername}@it.example.test`,
      firstName: "Tool",
      lastName: "Test",
      confirm: true,
    });
    expect(created.username).toBe(newUsername);
    newUserId = created.id;
    expect(newUserId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("user_get", async () => {
    const user = await ok<UserItem & { email?: string }>("user_get", {
      realm: REALM,
      userId: newUserId,
    });
    expect(user.username).toBe(newUsername);
    expect(user.email).toBe(`${newUsername}@it.example.test`);
  });

  it("user_update", async () => {
    const result = await ok<{ updatedFields: string[] }>("user_update", {
      realm: REALM,
      userId: newUserId,
      firstName: "Changed",
      confirm: true,
    });
    expect(result.updatedFields).toEqual(["firstName"]);
    const user = await ok<{ firstName?: string; lastName?: string }>("user_get", {
      realm: REALM,
      userId: newUserId,
    });
    expect(user.firstName).toBe("Changed");
    expect(user.lastName).toBe("Test");
  });

  it("user_send_actions_email (no SMTP in the test realm: clean error, no crash)", async () => {
    const result = await call("user_send_actions_email", {
      realm: REALM,
      userId: newUserId,
      actions: ["UPDATE_PASSWORD"],
      confirm: true,
    });
    // Keycloak cannot send mail without SMTP, so this cannot be a success here.
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/HTTP (4|5)\d\d/);
  });

  it("group_list", async () => {
    const page = await ok<Page<{ id: string; name: string; path?: string }>>("group_list", {
      realm: REALM,
    });
    expect(page.items.map((g) => g.name)).toEqual(expect.arrayContaining(["engineering", "ops"]));
    opsGroupId = page.items.find((g) => g.name === "ops")?.id as string;
    expect(opsGroupId).toBeDefined();
  });

  it("group_members_list", async () => {
    const page = await ok<Page<{ username: string }>>("group_members_list", {
      realm: REALM,
      groupId: opsGroupId,
    });
    expect(page.items.map((u) => u.username)).toContain("carol");
  });

  it("user_group_add", async () => {
    const result = await ok<{ added: boolean }>("user_group_add", {
      realm: REALM,
      userId: newUserId,
      groupId: opsGroupId,
      confirm: true,
    });
    expect(result.added).toBe(true);
    const page = await ok<Page<{ username: string }>>("group_members_list", {
      realm: REALM,
      groupId: opsGroupId,
    });
    expect(page.items.map((u) => u.username)).toContain(newUsername);
  });

  it("user_group_remove asks for confirmation first, then removes", async () => {
    const args = { realm: REALM, userId: newUserId, groupId: opsGroupId };
    const preview = await call("user_group_remove", args);
    expect(preview.isError).toBe(true);
    expect(textOf(preview)).toMatch(/Confirmation required/);
    const still = await ok<Page<{ username: string }>>("group_members_list", {
      realm: REALM,
      groupId: opsGroupId,
    });
    expect(still.items.map((u) => u.username)).toContain(newUsername);

    const removed = await ok<{ removed: boolean }>("user_group_remove", { ...args, confirm: true });
    expect(removed.removed).toBe(true);
    const after = await ok<Page<{ username: string }>>("group_members_list", {
      realm: REALM,
      groupId: opsGroupId,
    });
    expect(after.items.map((u) => u.username)).not.toContain(newUsername);
  });

  it("role_list (realm roles and client roles)", async () => {
    const page = await ok<Page<{ name: string }>>("role_list", { realm: REALM });
    expect(page.items.map((r) => r.name)).toEqual(
      expect.arrayContaining(["viewer", "editor", "composite-role"]),
    );
    const clientRoles = await ok<Page<{ name: string }>>("role_list", {
      realm: REALM,
      clientId: "realm-management",
      search: "view-users",
    });
    expect(clientRoles.items.map((r) => r.name)).toContain("view-users");
  });

  it("user_roles_list", async () => {
    const result = await ok<{ realmRoles: { name: string }[] }>("user_roles_list", {
      realm: REALM,
      userId: aliceId,
    });
    expect(result.realmRoles.map((r) => r.name)).toContain("viewer");
  });

  it("user_role_assign (plain role) and effective listing", async () => {
    const result = await ok<{ assigned: boolean }>("user_role_assign", {
      realm: REALM,
      userId: newUserId,
      roles: ["composite-role"],
      confirm: true,
    });
    expect(result.assigned).toBe(true);
    const effective = await ok<{ realmRoles: { name: string }[] }>("user_roles_list", {
      realm: REALM,
      userId: newUserId,
      effective: true,
    });
    // composite-role contains viewer
    expect(effective.realmRoles.map((r) => r.name)).toEqual(
      expect.arrayContaining(["composite-role", "viewer"]),
    );
  });

  it("user_role_assign needs confirm for administrative roles", async () => {
    const result = await call("user_role_assign", {
      realm: REALM,
      userId: newUserId,
      clientId: "realm-management",
      roles: ["realm-admin"],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Confirmation required/);
    const mappings = await ok<{ clientRoles?: unknown }>("user_roles_list", {
      realm: REALM,
      userId: newUserId,
    });
    expect(JSON.stringify(mappings)).not.toContain("realm-admin");
  });

  it("user_role_revoke asks for confirmation first, then revokes", async () => {
    const args = { realm: REALM, userId: newUserId, roles: ["composite-role"] };
    const preview = await call("user_role_revoke", args);
    expect(preview.isError).toBe(true);
    expect(textOf(preview)).toMatch(/Confirmation required/);

    const result = await ok<{ revoked: boolean }>("user_role_revoke", { ...args, confirm: true });
    expect(result.revoked).toBe(true);
    const after = await ok<{ realmRoles: { name: string }[] }>("user_roles_list", {
      realm: REALM,
      userId: newUserId,
    });
    expect(after.realmRoles.map((r) => r.name)).not.toContain("composite-role");
  });

  it("client_list never exposes secrets", async () => {
    const result = await server.call("client_list", { realm: REALM, search: "it-" });
    expect(result.isError).not.toBe(true);
    called.add("client_list");
    const page = result.structuredContent as unknown as Page<{ clientId: string }>;
    expect(page.items.map((c) => c.clientId)).toEqual(
      expect.arrayContaining([CLIENTS.app.clientId, CLIENTS.service.clientId]),
    );
    expect(JSON.stringify(result)).not.toContain(CLIENTS.app.secret);
  });

  it("client_get by clientId and by id, without secrets", async () => {
    const byClientId = await server.call("client_get", { realm: REALM, clientId: "it-app" });
    called.add("client_get");
    expect(byClientId.isError, textOf(byClientId)).not.toBe(true);
    const client = byClientId.structuredContent as unknown as {
      id: string;
      clientId: string;
      redirectUris: string[];
    };
    expect(client.clientId).toBe("it-app");
    expect(client.redirectUris).toContain("http://localhost:3000/*");
    expect(JSON.stringify(byClientId)).not.toContain(CLIENTS.app.secret);

    const byId = await ok<{ clientId: string }>("client_get", { realm: REALM, id: client.id });
    expect(byId.clientId).toBe("it-app");
  });

  it("user_sessions_list and user_logout (with confirmation)", async () => {
    expect(await passwordLogin(REALM, USERS.alice.username, USERS.alice.password)).toBe(200);

    const sessions = await ok<{ sessions: { id: string; clients: string[] }[] }>(
      "user_sessions_list",
      { realm: REALM, userId: aliceId },
    );
    expect(sessions.sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.sessions.flatMap((s) => s.clients)).toContain("it-app");

    const preview = await call("user_logout", { realm: REALM, userId: aliceId });
    expect(preview.isError).toBe(true);
    expect(textOf(preview)).toMatch(/Confirmation required/);

    const out = await ok<{ loggedOut: boolean }>("user_logout", {
      realm: REALM,
      userId: aliceId,
      confirm: true,
    });
    expect(out.loggedOut).toBe(true);
    const after = await ok<{ sessions: unknown[] }>("user_sessions_list", {
      realm: REALM,
      userId: aliceId,
    });
    expect(after.sessions).toHaveLength(0);
  });

  it("event_list returns the login event", async () => {
    const page = await ok<
      Page<{ type?: string; userId?: string; details: Record<string, string> }>
    >("event_list", { realm: REALM, type: ["LOGIN"], user: aliceId });
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect(page.items[0]?.type).toBe("LOGIN");
    expect(JSON.stringify(page)).not.toMatch(/"(code|refresh_token|token)"/);
  });

  it("admin_event_list returns the admin events of this run", async () => {
    const page = await ok<Page<{ operationType?: string; resourceType?: string }>>(
      "admin_event_list",
      { realm: REALM, resourceTypes: ["USER"] },
    );
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect(page.items.map((e) => e.resourceType)).toContain("USER");
  });

  it("user_brute_force_status and user_brute_force_unlock", async () => {
    const lockyId = await findUserId(REALM, USERS.locky.username);
    const clean = await ok<{ disabled: boolean; numFailures: number }>("user_brute_force_status", {
      realm: REALM,
      userId: lockyId,
    });
    expect(clean.disabled).toBe(false);

    for (let i = 0; i < 3; i++) {
      expect(
        await passwordLogin(REALM, USERS.locky.username, "wrong-password"),
      ).toBeGreaterThanOrEqual(400);
    }
    const locked = await ok<{ disabled: boolean; numFailures: number }>("user_brute_force_status", {
      realm: REALM,
      userId: lockyId,
    });
    expect(locked.disabled).toBe(true);
    // Keycloak stops counting once the user is locked, which can happen before failureFactor.
    expect(locked.numFailures).toBeGreaterThanOrEqual(1);

    const unlock = await ok<{ unlocked: boolean }>("user_brute_force_unlock", {
      realm: REALM,
      userId: lockyId,
      confirm: true,
    });
    expect(unlock.unlocked).toBe(true);
    const after = await ok<{ disabled: boolean; numFailures: number }>("user_brute_force_status", {
      realm: REALM,
      userId: lockyId,
    });
    expect(after.disabled).toBe(false);
    expect(after.numFailures).toBe(0);
    expect(await passwordLogin(REALM, USERS.locky.username, USERS.locky.password)).toBe(200);
  });

  it("user_delete asks for confirmation first, then deletes", async () => {
    const preview = await call("user_delete", { realm: REALM, userId: newUserId });
    expect(preview.isError).toBe(true);
    expect(textOf(preview)).toMatch(/Confirmation required/);
    await ok("user_get", { realm: REALM, userId: newUserId });

    const deleted = await ok<{ deleted: boolean }>("user_delete", {
      realm: REALM,
      userId: newUserId,
      confirm: true,
    });
    expect(deleted.deleted).toBe(true);
    const gone = await call("user_get", { realm: REALM, userId: newUserId });
    expect(gone.isError).toBe(true);
  });

  it("covered every registered tool", () => {
    const registered = Object.values(TOOLSETS).flatMap((tools) => tools.map((t) => t.name));
    expect([...called].sort()).toEqual([...registered].sort());
  });
});
