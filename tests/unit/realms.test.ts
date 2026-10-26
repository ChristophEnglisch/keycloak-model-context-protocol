import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness, textOf } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());

describe("realm_list", () => {
  it("returns a safe projection of realms", async () => {
    h = await startHarness();
    h.kc.realms.find.mockResolvedValue([
      { realm: "shop", displayName: "Shop", enabled: true, smtpServer: { password: "x" } },
      { realm: "master", enabled: true },
    ]);
    const result = await h.call("realm_list");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      items: [
        { realm: "master", enabled: true },
        { realm: "shop", displayName: "Shop", enabled: true },
      ],
      first: 0,
      max: 50,
      hasMore: false,
    });
    expect(JSON.stringify(result)).not.toContain("smtpServer");
  });

  it("honours the realm allowlist", async () => {
    h = await startHarness({ allowedRealms: ["shop"] });
    h.kc.realms.find.mockResolvedValue([{ realm: "shop" }, { realm: "master" }]);
    const result = await h.call("realm_list");
    expect((result.structuredContent as { items: unknown[] }).items).toEqual([{ realm: "shop" }]);
  });

  it("paginates", async () => {
    h = await startHarness();
    h.kc.realms.find.mockResolvedValue([{ realm: "a" }, { realm: "b" }, { realm: "c" }]);
    const result = await h.call("realm_list", { first: 1, max: 1 });
    expect(result.structuredContent).toMatchObject({ items: [{ realm: "b" }], hasMore: true });
  });

  it("returns isError for Keycloak failures", async () => {
    h = await startHarness();
    h.kc.realms.find.mockRejectedValue(new TypeError("fetch failed"));
    const result = await h.call("realm_list");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Cannot reach Keycloak/);
  });
});

describe("realm_get", () => {
  it("returns only the safe subset and passes the realm", async () => {
    h = await startHarness();
    h.kc.realms.findOne.mockResolvedValue({
      realm: "shop",
      displayName: "Shop",
      enabled: true,
      sslRequired: "external",
      bruteForceProtected: true,
      accessTokenLifespan: 300,
      smtpServer: { password: "hunter2", host: "smtp" },
      defaultSignatureAlgorithm: "RS256",
    });
    const result = await h.call("realm_get", { realm: "shop" });
    expect(h.kc.realms.findOne).toHaveBeenCalledWith({ realm: "shop" });
    expect(result.structuredContent).toEqual({
      realm: "shop",
      displayName: "Shop",
      enabled: true,
      sslRequired: "external",
      bruteForceProtected: true,
      accessTokenLifespan: 300,
    });
    expect(JSON.stringify(result)).not.toMatch(/hunter2|smtp/);
  });

  it("returns only allowlisted keys of a full representation", async () => {
    h = await startHarness();
    h.kc.realms.findOne.mockResolvedValue({
      realm: "shop",
      identityProviders: [{ config: { clientSecret: "IDP-SECRET" } }],
      attributes: { a: "b" },
      smtpServer: { password: "p" },
      components: {},
      clients: [],
      users: [],
      keycloakVersion: "x",
      browserSecurityHeaders: {},
      clientPolicies: {},
      otpPolicyInitialCounter: 0,
    });
    const result = await h.call("realm_get", { realm: "shop" });
    expect(Object.keys(result.structuredContent ?? {})).toEqual(["realm"]);
  });

  it("reports an unknown realm", async () => {
    h = await startHarness();
    h.kc.realms.findOne.mockResolvedValue(undefined);
    const result = await h.call("realm_get", { realm: "ghost" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/does not exist/);
  });

  it("enforces the realm allowlist", async () => {
    h = await startHarness({ allowedRealms: ["shop"] });
    const result = await h.call("realm_get", { realm: "other" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/KEYCLOAK_MCP_REALMS/);
    expect(h.kc.realms.findOne).not.toHaveBeenCalled();
  });
});
