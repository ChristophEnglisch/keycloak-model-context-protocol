import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { adminClient } from "./helpers/admin.js";
import { REALM, REALM_B, USERS, ZED } from "./helpers/constants.js";
import { describeIt } from "./helpers/context.js";
import { masterAdminEnv, type Page, type RealServer, startRealServer } from "./helpers/server.js";

describeIt("realm isolation with parallel calls", () => {
  let server: RealServer;
  const shared = `iso-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    server = await startRealServer(masterAdminEnv());
  });
  afterAll(async () => {
    await server?.close();
    const kc = await adminClient();
    for (const realm of [REALM, REALM_B]) {
      for (const user of await kc.users.find({ realm, username: shared, exact: true })) {
        if (user.id) await kc.users.del({ realm, id: user.id });
      }
    }
  });

  it("interleaved reads in two realms never mix up results", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) => {
      const inB = i % 2 === 1;
      return server
        .ok<Page<{ username: string }>>("user_search", {
          realm: inB ? REALM_B : REALM,
          search: inB ? ZED : USERS.alice.username,
        })
        .then((page) => ({ inB, names: page.items.map((u) => u.username) }));
    });
    for (const { inB, names } of await Promise.all(jobs)) {
      if (inB) {
        expect(names).toContain(ZED);
        expect(names).not.toContain(USERS.alice.username);
      } else {
        expect(names).toContain(USERS.alice.username);
        expect(names).not.toContain(ZED);
      }
    }
  });

  it("parallel writes of the same username land in the right realm only", async () => {
    const [a, b] = await Promise.all([
      server.ok<{ id: string; realm: string }>("user_create", {
        realm: REALM,
        username: shared,
        confirm: true,
      }),
      server.ok<{ id: string; realm: string }>("user_create", {
        realm: REALM_B,
        username: shared,
        confirm: true,
      }),
    ]);
    expect(a.realm).toBe(REALM);
    expect(b.realm).toBe(REALM_B);
    expect(a.id).not.toBe(b.id);

    const kc = await adminClient();
    expect(await kc.users.findOne({ realm: REALM, id: a.id })).toBeDefined();
    expect(await kc.users.findOne({ realm: REALM_B, id: b.id })).toBeDefined();
    // The id of one realm does not exist in the other (the admin client returns null on 404).
    expect(await kc.users.findOne({ realm: REALM_B, id: a.id }).catch(() => null)).toBeNull();

    const crossGet = await server.call("user_get", { realm: REALM_B, userId: a.id });
    expect(crossGet.isError).toBe(true);
  });
});
