import { afterAll, beforeAll, expect, it } from "vitest";
import { adminClient, findUserId, realmNames } from "./helpers/admin.js";
import { REALM, REALM_B, USERS } from "./helpers/constants.js";
import { describeIt } from "./helpers/context.js";
import { masterAdminEnv, type RealServer, startRealServer, textOf } from "./helpers/server.js";

describeIt("SEC-08: path traversal is stopped by the guards", () => {
  let server: RealServer;
  beforeAll(async () => {
    server = await startRealServer(masterAdminEnv());
  });
  afterAll(async () => {
    await server?.close();
  });

  const attacks: [string, Record<string, unknown>][] = [
    ["user_get", { realm: REALM, userId: ".." }],
    ["user_get", { realm: "a/..", userId: ".." }],
    ["user_delete", { realm: REALM, userId: "..", confirm: true }],
    ["user_delete", { realm: "a/..", userId: "..", confirm: true }],
    ["user_delete", { realm: "a/..", userId: "x", confirm: true }],
    ["user_delete", { realm: "..", userId: "..", confirm: true }],
    ["user_delete", { realm: REALM, userId: "../../..", confirm: true }],
    ["user_search", { realm: "a/.." }],
    ["user_brute_force_unlock", { realm: "a/..", userId: ".." }],
  ];

  it.each(attacks)("%s %j is rejected before any request is made", async (tool, args) => {
    const result = await server.call(tool, args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Invalid (realm|userId)/);
  });

  it("realms and users still exist afterwards", async () => {
    expect(await realmNames()).toEqual(expect.arrayContaining(["master", REALM, REALM_B]));
    expect(await findUserId(REALM, USERS.alice.username)).toBeTruthy();
    const kc = await adminClient();
    const realm = await kc.realms.findOne({ realm: REALM });
    expect(realm?.realm).toBe(REALM);
  });
});

describeIt("realm guards with a real Keycloak", () => {
  it("KEYCLOAK_MCP_REALMS restricts the target realms", async () => {
    const server = await startRealServer(masterAdminEnv(), { KEYCLOAK_MCP_REALMS: REALM });
    try {
      await server.ok("user_search", { realm: REALM });
      const denied = await server.call("user_search", { realm: REALM_B });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toMatch(/not permitted by KEYCLOAK_MCP_REALMS/);
      const realms = await server.ok<{ items: { realm: string }[] }>("realm_list", {});
      expect(realms.items.map((r) => r.realm)).toEqual([REALM]);
    } finally {
      await server.close();
    }
  });

  it("writes into master are blocked by default", async () => {
    const server = await startRealServer(masterAdminEnv());
    try {
      const result = await server.call("user_create", {
        realm: "master",
        username: "must-not-exist",
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/master/);
      const kc = await adminClient();
      expect(
        await kc.users.find({ realm: "master", username: "must-not-exist", exact: true }),
      ).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("read-only mode registers no write tools", async () => {
    const server = await startRealServer(masterAdminEnv(), { KEYCLOAK_MCP_READ_ONLY: "true" });
    try {
      const { tools } = await server.client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    } finally {
      await server.close();
    }
  });
});
