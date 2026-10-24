import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOLSETS } from "../../src/tools/index.js";
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
import { ROLE_MATRIX, ROLE_MATRIX_BY_TOOL } from "./role-matrix.js";

describe("role matrix definition", () => {
  it("has exactly one row per registered tool", () => {
    const registered = Object.values(TOOLSETS)
      .flatMap((tools) => tools.map((tool) => tool.name))
      .sort();
    expect(ROLE_MATRIX.map((row) => row.tool).sort()).toEqual(registered);
    expect(registered).toHaveLength(24);
  });
});

interface Fixtures {
  aliceId: string;
  groupId: string;
}

type ArgsBuilder = (f: Fixtures) => Promise<Record<string, unknown>> | Record<string, unknown>;

const PREFIX = "mx";

/** Arguments for one valid call of each tool (the ones with side effects get a fresh user). */
const CASES: Record<string, ArgsBuilder> = {
  realm_get: () => ({ realm: REALM }),
  user_search: () => ({ realm: REALM, search: "alice" }),
  user_get: (f) => ({ realm: REALM, userId: f.aliceId }),
  user_create: () => ({ realm: REALM, username: `${PREFIX}-${randomUUID().slice(0, 8)}` }),
  user_update: async () => ({
    realm: REALM,
    userId: (await createUser(REALM, PREFIX)).id,
    firstName: "Changed",
  }),
  user_delete: async () => ({
    realm: REALM,
    userId: (await createUser(REALM, PREFIX)).id,
    confirm: true,
  }),
  group_list: () => ({ realm: REALM }),
  group_members_list: (f) => ({ realm: REALM, groupId: f.groupId }),
  user_group_add: async (f) => ({
    realm: REALM,
    userId: (await createUser(REALM, PREFIX)).id,
    groupId: f.groupId,
  }),
  user_group_remove: async (f) => {
    const { id } = await createUser(REALM, PREFIX);
    const kc = await adminClient();
    await kc.users.addToGroup({ realm: REALM, id, groupId: f.groupId });
    return { realm: REALM, userId: id, groupId: f.groupId, confirm: true };
  },
  role_list: () => ({ realm: REALM }),
  user_roles_list: (f) => ({ realm: REALM, userId: f.aliceId }),
  user_role_assign: async () => ({
    realm: REALM,
    userId: (await createUser(REALM, PREFIX)).id,
    roles: ["editor"],
  }),
  user_role_revoke: async () => {
    const { id } = await createUser(REALM, PREFIX);
    const kc = await adminClient();
    const role = await kc.roles.findOneByName({ realm: REALM, name: "editor" });
    await kc.users.addRealmRoleMappings({
      realm: REALM,
      id,
      roles: [{ id: role?.id as string, name: "editor" }],
    });
    return { realm: REALM, userId: id, roles: ["editor"], confirm: true };
  },
  client_list: () => ({ realm: REALM }),
  client_get: () => ({ realm: REALM, clientId: CLIENTS.app.clientId }),
  user_sessions_list: (f) => ({ realm: REALM, userId: f.aliceId }),
  user_logout: async () => ({
    realm: REALM,
    userId: (await createUser(REALM, PREFIX)).id,
    confirm: true,
  }),
  event_list: () => ({ realm: REALM, max: 1 }),
  admin_event_list: () => ({ realm: REALM, max: 1 }),
  user_brute_force_status: (f) => ({ realm: REALM, userId: f.aliceId }),
  user_brute_force_unlock: (f) => ({ realm: REALM, userId: f.aliceId }),
};

describeIt("role matrix against a real Keycloak", () => {
  const accounts = new Map<string, { account: ServiceAccount; server: RealServer }>();
  let fixtures: Fixtures;

  /** One service account (and MCP server) per distinct role set, created lazily. */
  async function serverWithRoles(roles: readonly string[]): Promise<RealServer> {
    const key = [...roles].sort().join(",") || "(none)";
    let entry = accounts.get(key);
    if (!entry) {
      const account = await createServiceAccount(REALM, roles);
      const server = await startRealServer(
        serviceAccountEnv(REALM, account.clientId, account.secret),
      );
      entry = { account, server };
      accounts.set(key, entry);
    }
    return entry.server;
  }

  beforeAll(async () => {
    const kc = await adminClient();
    const [ops] = await kc.groups.find({ realm: REALM, search: "ops", exact: true });
    fixtures = {
      aliceId: await findUserId(REALM, USERS.alice.username),
      groupId: ops?.id as string,
    };
  });

  afterAll(async () => {
    for (const { account, server } of accounts.values()) {
      await server.close();
      await deleteClient(account.realm, account.id);
    }
    await deleteUsersByPrefix(REALM, PREFIX);
  });

  for (const row of ROLE_MATRIX.filter((r) => r.status === "tested")) {
    describe(row.tool, () => {
      const build = CASES[row.tool];

      it("is covered by a test case", () => {
        expect(build, `no CASES entry for ${row.tool}`).toBeDefined();
      });

      it(`works with ${row.minimalRoles.join(" + ")}`, async () => {
        const server = await serverWithRoles(row.minimalRoles);
        const result = await server.call(row.tool, await (build as ArgsBuilder)(fixtures));
        expect(result.isError, textOf(result)).not.toBe(true);
      });

      const denied = row.deniedWith.length > 0 ? row.deniedWith.join(" + ") : "no admin role";
      it(`fails with a readable 403 for ${denied}`, async () => {
        const server = await serverWithRoles(row.deniedWith);
        const result = await server.call(row.tool, await (build as ArgsBuilder)(fixtures));
        const text = textOf(result);
        expect(text).not.toMatch(/secret-[0-9a-f-]{36}/);
        const forbidden = result.isError === true && text.includes("HTTP 403");
        if (row.deniedMayBeHidden && !forbidden) {
          // Keycloak < 26.8 filters clients instead of answering 403.
          if (result.isError) {
            expect(text).toMatch(/query-clients|view-clients/);
          } else {
            const visible = JSON.stringify(result.structuredContent ?? {});
            expect(visible).not.toContain(`"${CLIENTS.app.clientId}"`);
          }
          return;
        }
        expect(result.isError).toBe(true);
        expect(text).toContain("HTTP 403");
        expect(text).toContain("realm-management");
      });
    });
  }

  it("keeps the matrix definition consistent with the tests", () => {
    for (const row of ROLE_MATRIX_BY_TOOL.values()) {
      if (row.status === "tested") expect(CASES[row.tool]).toBeDefined();
    }
  });
});
