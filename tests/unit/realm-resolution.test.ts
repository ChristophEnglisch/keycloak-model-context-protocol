import { NetworkError } from "@keycloak/keycloak-admin-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPathSegment,
  REALM_CACHE_TTL_MS,
  type RealmPolicy,
  resolveWriteRealm,
} from "../../src/guards.js";
import { ToolError } from "../../src/keycloak/errors.js";
import { createFakeGateway, type FakeKc } from "../helpers/fakes.js";
import { type Harness, startHarness, textOf } from "../helpers/harness.js";

/**
 * Looks names up like an accent- and case-insensitive database collation
 * (e.g. MySQL utf8mb4_0900_ai_ci): compatibility forms, case, accents and
 * zero-width characters do not matter.
 */
function collationKey(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[​-‍⁠﻿]/g, "").toLowerCase();
}

/** Lets `kc.realms.findOne` resolve names like a case- and accent-insensitive database. */
function collatingRealms(kc: FakeKc, stored: Record<string, string>) {
  kc.realms.findOne.mockImplementation(async (payload) => {
    const key = collationKey(payload?.realm ?? "");
    const name = Object.keys(stored).find((n) => collationKey(n) === key);
    return name === undefined ? undefined : { id: stored[name], realm: name };
  });
}

const forbidden = () =>
  new NetworkError("403", { response: new Response(null, { status: 403 }), responseData: {} });

const VARIANTS = ["MASTER", "Master", "mäster", "ｍａｓｔｅｒ", "maſter", "mastér"];

describe("assertPathSegment: invisible characters and whitespace", () => {
  it.each([
    ["zero-width space", "master​"],
    ["zero-width joiner", "mas‍ter"],
    ["word joiner", "⁠master"],
    ["byte order mark", "﻿master"],
    ["soft hyphen", "mas­ter"],
    ["right-to-left override", "‮master"],
    ["bidi isolate", "master⁦"],
    ["left-to-right mark", "master‎"],
    ["arabic letter mark", "master؜"],
    ["variation selector", "master️"],
    ["C1 control", "master\u0085"],
    ["unpaired surrogate", "master\ud800"],
    ["leading space", " master"],
    ["trailing space", "master "],
    ["trailing no-break space", "master "],
    ["leading ideographic space", "　master"],
  ])("rejects a %s", (_label, value) => {
    expect(() => assertPathSegment(value, "realm")).toThrow(ToolError);
  });

  it.each(["mäster", "ｍａｓｔｅｒ", "maſter", "Ärzte & Pflege", "東京", "my realm", "a.b-c_d"])(
    "accepts the Unicode name %j (Keycloak allows it)",
    (value) => {
      expect(() => assertPathSegment(value, "realm")).not.toThrow();
    },
  );

  it("names the rule in the error", () => {
    expect(() => assertPathSegment("x​", "realm")).toThrow(/invisible characters/);
  });
});

describe("resolveWriteRealm", () => {
  const open: RealmPolicy = { allowedRealms: [], allowMasterWrite: false };

  function setup(stored: Record<string, string> = { master: "id-m", shop: "id-s" }) {
    const { gateway, kc } = createFakeGateway();
    collatingRealms(kc, stored);
    return { gateway, kc };
  }

  it.each(VARIANTS)("blocks a write to %j when Keycloak resolves it to master", async (name) => {
    const { gateway } = setup();
    await expect(resolveWriteRealm({ config: open, gateway }, name)).rejects.toThrow(
      /Write operations in the 'master' realm are disabled/,
    );
  });

  it("returns the stored name when master writes are allowed", async () => {
    const { gateway } = setup();
    const config = { ...open, allowMasterWrite: true };
    await expect(resolveWriteRealm({ config, gateway }, "mäster")).resolves.toEqual({
      name: "master",
      id: "id-m",
    });
  });

  it("returns the stored name of an ordinary realm", async () => {
    const { gateway } = setup();
    await expect(resolveWriteRealm({ config: open, gateway }, "SHOP")).resolves.toEqual({
      name: "shop",
      id: "id-s",
    });
  });

  it("applies the allowlist to the name as given and to the resolved name", async () => {
    const { gateway } = setup({ master: "id-m", shop: "id-s" });
    const exact: RealmPolicy = { allowedRealms: ["shop"], allowMasterWrite: false };
    await expect(resolveWriteRealm({ config: exact, gateway }, "shop")).resolves.toMatchObject({
      name: "shop",
    });
    await expect(resolveWriteRealm({ config: exact, gateway }, "SHOP")).rejects.toThrow(
      /not permitted by KEYCLOAK_MCP_REALMS/,
    );
    // An allowlisted name that Keycloak resolves to a different realm.
    const lookalike: RealmPolicy = { allowedRealms: ["shöp"], allowMasterWrite: false };
    await expect(resolveWriteRealm({ config: lookalike, gateway }, "shöp")).rejects.toThrow(
      /Realm 'shop' is not permitted/,
    );
  });

  it("compares the id with the id of master", async () => {
    const { gateway, kc } = setup();
    kc.realms.findOne.mockImplementation(async (payload) =>
      payload?.realm === "master"
        ? { id: "id-m", realm: "master" }
        : { id: "id-m", realm: "renamed" },
    );
    await expect(resolveWriteRealm({ config: open, gateway }, "renamed")).rejects.toThrow(
      /'master' realm are disabled/,
    );
  });

  it("works when the account cannot see master or the realm id", async () => {
    const { gateway, kc } = setup();
    kc.realms.findOne.mockImplementation(async (payload) => {
      if (payload?.realm === "master") throw forbidden();
      return { realm: "shop" };
    });
    await expect(resolveWriteRealm({ config: open, gateway }, "shop")).resolves.toEqual({
      name: "shop",
    });
  });

  it("reports an unknown realm as not found", async () => {
    const { gateway } = setup();
    await expect(resolveWriteRealm({ config: open, gateway }, "nope")).rejects.toMatchObject({
      kind: "not_found",
      message: expect.stringMatching(/Realm 'nope' does not exist/),
    });
  });

  it("passes Keycloak errors of the target lookup on", async () => {
    const { gateway, kc } = setup();
    kc.realms.findOne.mockRejectedValue(forbidden());
    await expect(resolveWriteRealm({ config: open, gateway }, "shop")).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("caches per name for the TTL and asks again afterwards", async () => {
    const { gateway, kc } = setup();
    const ctx = { config: open, gateway };
    await resolveWriteRealm(ctx, "shop", 1_000);
    await resolveWriteRealm(ctx, "shop", 1_000 + REALM_CACHE_TTL_MS - 1);
    const lookups = () => kc.realms.findOne.mock.calls.filter(([p]) => p?.realm === "shop").length;
    expect(lookups()).toBe(1);
    await resolveWriteRealm(ctx, "shop", 1_000 + REALM_CACHE_TTL_MS);
    expect(lookups()).toBe(2);
  });

  it("does not cache unknown realms", async () => {
    const { gateway, kc } = setup({ master: "id-m" });
    const ctx = { config: open, gateway };
    await expect(resolveWriteRealm(ctx, "new", 1_000)).rejects.toThrow(/does not exist/);
    collatingRealms(kc, { master: "id-m", new: "id-n" });
    await expect(resolveWriteRealm(ctx, "new", 1_001)).resolves.toMatchObject({ name: "new" });
  });

  it("checks the name as given before asking Keycloak", async () => {
    const { gateway, kc } = setup();
    await expect(resolveWriteRealm({ config: open, gateway }, "master")).rejects.toThrow(
      /'master' realm are disabled/,
    );
    await expect(resolveWriteRealm({ config: open, gateway }, "a/..")).rejects.toThrow(
      /Invalid realm/,
    );
    expect(kc.realms.findOne).not.toHaveBeenCalled();
  });
});

describe("write tools use the realm Keycloak resolves", () => {
  let h: Harness;
  afterEach(async () => h?.close());

  it.each(VARIANTS)("user_create in %j is blocked and nothing is written", async (realm) => {
    h = await startHarness();
    collatingRealms(h.kc, { master: "id-m", shop: "id-s" });
    const result = await h.call("user_create", { realm, username: "x", confirm: true });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/ALLOW_MASTER_WRITE/);
    expect(h.kc.users.create).not.toHaveBeenCalled();
    expect(h.logs.join("\n")).toMatch(/"outcome":"guard"/);
  });

  it("sends the stored realm name to Keycloak and reports it", async () => {
    h = await startHarness();
    collatingRealms(h.kc, { master: "id-m", shop: "id-s" });
    h.kc.users.create.mockResolvedValue({ id: "new" });
    const result = await h.call("user_create", { realm: "Shöp", username: "x", confirm: true });
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(h.kc.users.create).toHaveBeenCalledWith(expect.objectContaining({ realm: "shop" }));
    expect(result.structuredContent).toMatchObject({ realm: "shop" });
    expect(h.logs.join("\n")).toMatch(/"tool":"user_create","realm":"shop"/);
  });

  it("reads keep the name as given and do not resolve it", async () => {
    h = await startHarness();
    h.kc.users.find.mockResolvedValue([]);
    await h.call("user_search", { realm: "shop" });
    expect(h.kc.realms.findOne).not.toHaveBeenCalled();
  });

  it("user_role_assign checks the role name Keycloak returns, not the one given", async () => {
    h = await startHarness({ requireConfirmation: false });
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob" });
    h.kc.users.addRealmRoleMappings.mockResolvedValue(undefined);
    h.kc.clients.find.mockResolvedValue([{ id: "rm", clientId: "realm-management" }]);
    // A collation-insensitive lookup: "ADMIN" and "ädmin" find the role "admin".
    h.kc.roles.findOneByName.mockImplementation(async (payload) =>
      collationKey(payload?.name ?? "") === "admin" ? { id: "r-admin", name: "admin" } : undefined,
    );
    for (const roles of [["ADMIN"], ["ädmin"], ["admin", "ADMIN"]]) {
      const result = await h.call("user_role_assign", { realm: "shop", userId: "u1", roles });
      expect(result.isError, String(roles)).toBe(true);
      expect(textOf(result)).toContain('This grants administrative rights: "admin".');
      expect(textOf(result)).toMatch(/cannot be turned off/);
    }
    expect(h.kc.users.addRealmRoleMappings).not.toHaveBeenCalled();

    const confirmed = await h.call("user_role_assign", {
      realm: "shop",
      userId: "u1",
      roles: ["admin", "ADMIN"],
      confirm: true,
    });
    expect(confirmed.isError, textOf(confirmed)).toBeFalsy();
    // Duplicates that resolve to the same role are sent once, under the stored name.
    expect(h.kc.users.addRealmRoleMappings).toHaveBeenCalledWith({
      realm: "shop",
      id: "u1",
      roles: [{ id: "r-admin", name: "admin" }],
    });
  });
});
