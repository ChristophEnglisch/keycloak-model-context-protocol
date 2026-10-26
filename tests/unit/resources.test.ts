import { afterEach, describe, expect, it } from "vitest";
import { segment } from "../../src/resources/shared.js";
import { type Harness, startHarness } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());

async function read(uri: string): Promise<{ text: string; json: Record<string, unknown> }> {
  const res = await h.client.readResource({ uri });
  const c = res.contents[0];
  expect(c?.mimeType).toBe("application/json");
  const text = (c as { text: string }).text;
  return { text, json: JSON.parse(text) };
}

describe("resources", () => {
  it("lists the static resource and the templates", async () => {
    h = await startHarness();
    h.kc.realms.find.mockResolvedValue([{ realm: "shop" }]);
    const { resources } = await h.client.listResources();
    expect(resources.map((r) => r.uri)).toContain("keycloak://realms");
    expect(resources.map((r) => r.uri)).toContain("keycloak://realms/shop");
    const { resourceTemplates } = await h.client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      "keycloak://realms/{realm}",
      "keycloak://realms/{realm}/security-summary",
      "keycloak://realms/{realm}/users/{userId}",
    ]);
  });

  it("keycloak://realms respects the allowlist", async () => {
    h = await startHarness({ allowedRealms: ["shop"] });
    h.kc.realms.find.mockResolvedValue([{ realm: "shop" }, { realm: "master" }]);
    expect((await read("keycloak://realms")).json).toEqual({ realms: ["shop"] });
  });

  it("reads safe realm settings only", async () => {
    h = await startHarness();
    h.kc.realms.findOne.mockResolvedValue({
      realm: "shop",
      sslRequired: "all",
      bruteForceProtected: true,
      smtpServer: { password: "smtp-secret" },
    });
    const { text, json } = await read("keycloak://realms/shop");
    expect(json).toEqual({ realm: "shop", sslRequired: "all", bruteForceProtected: true });
    expect(text).not.toContain("smtp-secret");
  });

  it("reads a safe user projection", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({
      id: "u1",
      username: "jdoe",
      attributes: { pin: ["1234"] },
      credentials: [{ value: "pw" }],
      totp: true,
    });
    const { text, json } = await read("keycloak://realms/shop/users/u1");
    expect(json).toEqual({ id: "u1", username: "jdoe", totp: true });
    expect(text).not.toContain("1234");
    expect(h.kc.users.findOne).toHaveBeenCalledWith({ realm: "shop", id: "u1" });
  });

  it("aggregates the security summary without secrets", async () => {
    h = await startHarness();
    h.kc.realms.findOne.mockResolvedValue({
      realm: "shop",
      bruteForceProtected: true,
      passwordPolicy: "length(12)",
      sslRequired: "external",
      otpPolicyType: "totp",
      eventsEnabled: true,
      smtpServer: { password: "smtp-secret" },
    });
    h.kc.clients.find.mockResolvedValue([
      { clientId: "a", publicClient: true, directAccessGrantsEnabled: true, secret: "cs-1" },
      { clientId: "b", publicClient: true, secret: "cs-2" },
      { clientId: "c", publicClient: false, directAccessGrantsEnabled: true },
    ]);
    const { text, json } = await read("keycloak://realms/shop/security-summary");
    expect(json).toEqual({
      realm: "shop",
      bruteForceProtected: true,
      passwordPolicy: "length(12)",
      sslRequired: "external",
      otpPolicyType: "totp",
      eventsEnabled: true,
      adminEventsEnabled: false,
      clients: { total: 3, public: 2, directAccessGrantsEnabled: 2, truncated: false },
    });
    expect(text).not.toMatch(/cs-1|cs-2|smtp-secret|secret/);
  });

  it("blocks realms outside the allowlist without calling Keycloak", async () => {
    h = await startHarness({ allowedRealms: ["shop"] });
    for (const uri of [
      "keycloak://realms/other",
      "keycloak://realms/other/users/u1",
      "keycloak://realms/other/security-summary",
    ]) {
      await expect(h.client.readResource({ uri })).rejects.toThrow(/not permitted/);
    }
    expect(h.kc.realms.findOne).not.toHaveBeenCalled();
    expect(h.kc.users.findOne).not.toHaveBeenCalled();
  });

  it("never reaches Keycloak for dot segments", async () => {
    h = await startHarness();
    for (const uri of ["keycloak://realms/shop/users/..", "keycloak://realms/../users/u1"]) {
      await expect(h.client.readResource({ uri })).rejects.toThrow();
    }
    expect(h.kc.users.findOne).not.toHaveBeenCalled();
  });

  it("blocks a backslash in the user id without calling Keycloak", async () => {
    // Unlike "..", a backslash survives URL parsing, so this reaches the segment guard.
    h = await startHarness();
    await expect(
      h.client.readResource({ uri: "keycloak://realms/shop/users/a\\b" }),
    ).rejects.toThrow();
    expect(h.kc.users.findOne).not.toHaveBeenCalled();
  });

  it("maps 404 and missing objects to clean errors", async () => {
    h = await startHarness();
    h.kc.realms.findOne.mockResolvedValue(undefined);
    await expect(h.client.readResource({ uri: "keycloak://realms/ghost" })).rejects.toThrow(
      /Realm 'ghost' does not exist/,
    );
    h.kc.users.findOne.mockResolvedValue(undefined);
    await expect(h.client.readResource({ uri: "keycloak://realms/shop/users/u9" })).rejects.toThrow(
      /User u9 does not exist/,
    );
    h.kc.realms.findOne.mockRejectedValue(new TypeError("fetch failed"));
    await expect(h.client.readResource({ uri: "keycloak://realms/shop" })).rejects.toThrow(
      /Cannot reach Keycloak/,
    );
  });

  it("completes the realm template variable", async () => {
    h = await startHarness({ allowedRealms: ["shop", "sales"] });
    h.kc.realms.find.mockResolvedValue([{ realm: "shop" }, { realm: "sales" }, { realm: "hr" }]);
    const res = await h.client.complete({
      ref: { type: "ref/resource", uri: "keycloak://realms/{realm}/security-summary" },
      argument: { name: "realm", value: "sh" },
    });
    expect(res.completion.values).toEqual(["shop"]);
  });
});

describe("segment", () => {
  it.each(["..", ".", "a/b", "a\\b", ""])("rejects %j", (value) => {
    expect(() => segment(value, "userId")).toThrow(/Invalid userId/);
  });

  it("rejects a missing variable and takes the first of several values", () => {
    expect(() => segment(undefined, "realm")).toThrow(/Invalid realm/);
    expect(segment(["shop", "other"], "realm")).toBe("shop");
  });
});
