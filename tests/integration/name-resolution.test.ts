import { afterAll, beforeAll, expect, it } from "vitest";
import { adminClient, createUser, deleteUsersByPrefix } from "./helpers/admin.js";
import { REALM } from "./helpers/constants.js";
import { describeIt, keycloak } from "./helpers/context.js";
import { masterAdminEnv, type RealServer, startRealServer, textOf } from "./helpers/server.js";

// Runs in the normal suite (Keycloak's dev database, which compares names exactly) and,
// via vitest.integration-mysql.config.ts, against MySQL 8.4, whose default collation
// ignores case and accents. The guards must hold on both.
const PREFIX = "it-names";
const MASTER_VARIANTS = ["MASTER", "Master", "mäster", "ｍａｓｔｅｒ", "maſter", "mastér"];
const INVISIBLE_VARIANTS = ["master​", "​master", "mas­ter", "master‮"];
const ROLE_VARIANTS = ["ADMIN", "Admin", "ädmin"];

const collating = () => keycloak().db === "mysql";

describeIt("realm and role names are resolved by Keycloak before guards apply", () => {
  let server: RealServer;
  beforeAll(async () => {
    server = await startRealServer(masterAdminEnv(), {
      KEYCLOAK_MCP_REQUIRE_CONFIRMATION: "false",
    });
  });
  afterAll(async () => {
    await server?.close();
    await deleteUsersByPrefix("master", PREFIX);
    await deleteUsersByPrefix(REALM, PREFIX);
    const kc = await adminClient();
    if (await kc.roles.findOneByName({ realm: REALM, name: "admin" })) {
      await kc.roles.delByName({ realm: REALM, name: "admin" });
    }
  });

  async function usersInMaster(): Promise<string[]> {
    const kc = await adminClient();
    const users = await kc.users.find({ realm: "master", search: PREFIX, max: 100 });
    return users.map((u) => u.username ?? "");
  }

  it("the database behaves as expected for this run", async () => {
    // Guards against a silently wrong setup: on MySQL the variants must reach master.
    const kc = await adminClient();
    const found = await kc.realms.findOne({ realm: "mäster" });
    expect(found?.realm).toBe(collating() ? "master" : undefined);
  });

  it.each(MASTER_VARIANTS)("user_create in %j does not write to master", async (realm) => {
    const result = await server.call("user_create", {
      realm,
      username: `${PREFIX}-${MASTER_VARIANTS.indexOf(realm)}`,
      confirm: true,
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    if (collating() || realm.toLowerCase() === "master") {
      expect(text).toMatch(/Write operations in the 'master' realm are disabled/);
    } else {
      expect(text).toMatch(/Realm '.+' does not exist/);
    }
    expect(await usersInMaster()).toEqual([]);
  });

  it.each(INVISIBLE_VARIANTS)("rejects the invisible character in %j", async (realm) => {
    for (const tool of ["user_create", "user_search"]) {
      const result = await server.call(tool, { realm, username: `${PREFIX}-inv`, confirm: true });
      expect(result.isError, tool).toBe(true);
      expect(textOf(result)).toMatch(/Invalid realm/);
    }
    expect(await usersInMaster()).toEqual([]);
  });

  it("a write uses the realm name Keycloak stores", async () => {
    const result = await server.call("user_create", {
      realm: "IT-REALM",
      username: `${PREFIX}-canonical`,
      confirm: true,
    });
    if (!collating()) {
      expect(textOf(result)).toMatch(/Realm 'IT-REALM' does not exist/);
      return;
    }
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ realm: REALM });
    expect(textOf(result)).toContain(`in realm '${REALM}'`);
  });

  it("the allowlist applies to the name as given and to the resolved realm", async () => {
    const restricted = await startRealServer(masterAdminEnv(), { KEYCLOAK_MCP_REALMS: REALM });
    try {
      const result = await restricted.call("user_create", {
        realm: "IT-REALM",
        username: `${PREFIX}-allow`,
        confirm: true,
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/not permitted by KEYCLOAK_MCP_REALMS/);
    } finally {
      await restricted.close();
    }
  });

  it("with master writes allowed, a variant still ends up as 'master' in the result", async () => {
    const open = await startRealServer(masterAdminEnv(), {
      KEYCLOAK_MCP_ALLOW_MASTER_WRITE: "true",
    });
    try {
      const result = await open.call("user_create", {
        realm: "mäster",
        username: `${PREFIX}-allowed`,
        confirm: true,
      });
      if (!collating()) {
        expect(textOf(result)).toMatch(/does not exist/);
        return;
      }
      expect(result.isError, textOf(result)).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ realm: "master" });
      expect(await usersInMaster()).toEqual([`${PREFIX}-allowed`]);
    } finally {
      await open.close();
      await deleteUsersByPrefix("master", PREFIX);
    }
  });

  it.each(ROLE_VARIANTS)(
    "assigning the role %j is checked as the role Keycloak finds",
    async (role) => {
      // A realm role named exactly like master's superuser role, in an ordinary realm.
      const kc = await adminClient();
      if (!(await kc.roles.findOneByName({ realm: REALM, name: "admin" }))) {
        await kc.roles.create({ realm: REALM, name: "admin" });
      }
      const user = await createUser(REALM, PREFIX);
      const result = await server.call("user_role_assign", {
        realm: REALM,
        userId: user.id,
        roles: [role],
      });
      expect(result.isError).toBe(true);
      if (collating()) {
        // KEYCLOAK_MCP_REQUIRE_CONFIRMATION=false does not apply to administrative roles.
        expect(textOf(result)).toContain('This grants administrative rights: "admin".');
        expect(textOf(result)).toMatch(/cannot be turned off/);
      } else {
        expect(textOf(result)).toMatch(/Unknown role\(s\)/);
      }
      const mappings = await kc.users.listRealmRoleMappings({ realm: REALM, id: user.id });
      expect(mappings.map((m) => m.name)).not.toContain("admin");
    },
  );
});
