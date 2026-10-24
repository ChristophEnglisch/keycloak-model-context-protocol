import { NetworkError } from "@keycloak/keycloak-admin-client";
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness, textOf } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());
const start = (o = {}) => startHarness({ toolsets: new Set(["clients"]), ...o });

const leaky = {
  id: "c1",
  clientId: "app",
  name: "App",
  enabled: true,
  protocol: "openid-connect",
  publicClient: false,
  secret: "TOP-SECRET-VALUE",
  registrationAccessToken: "REG-TOKEN-VALUE",
  attributes: { "saml.signing.private.key": "PRIVATE-KEY-VALUE" },
  protocolMappers: [{ name: "m", config: { x: "MAPPER-CONFIG-VALUE" } }],
  rootUrl: "https://app.example.com",
  redirectUris: ["https://app.example.com/*"],
  webOrigins: ["+"],
};

function expectNoSecrets(result: unknown) {
  const s = JSON.stringify(result);
  for (const v of [
    "TOP-SECRET-VALUE",
    "REG-TOKEN-VALUE",
    "PRIVATE-KEY-VALUE",
    "MAPPER-CONFIG-VALUE",
  ])
    expect(s).not.toContain(v);
}

describe("client_list", () => {
  it("lists with search, explicit realm and max+1 pagination, without secrets", async () => {
    h = await start();
    h.kc.clients.find.mockResolvedValue([
      leaky,
      { id: "c2", clientId: "b" },
      { id: "c3", clientId: "c" },
    ]);
    const result = await h.call("client_list", { realm: "shop", search: "ap", max: 2 });
    expect(h.kc.clients.find).toHaveBeenCalledWith({
      realm: "shop",
      first: 0,
      max: 3,
      clientId: "ap",
      search: true,
    });
    const data = result.structuredContent as { items: unknown[]; hasMore: boolean };
    expect(data.items).toHaveLength(2);
    expect(data.hasMore).toBe(true);
    expect(data.items[0]).toEqual({
      id: "c1",
      clientId: "app",
      name: "App",
      enabled: true,
      protocol: "openid-connect",
      publicClient: false,
    });
    expectNoSecrets(result);
  });

  it("is limited by the realm allowlist and maps 404", async () => {
    h = await start({ allowedRealms: ["shop"] });
    expect((await h.call("client_list", { realm: "other" })).isError).toBe(true);
    expect(h.kc.clients.find).not.toHaveBeenCalled();
    h.kc.clients.find.mockRejectedValue(
      new NetworkError("404", { response: new Response(null, { status: 404 }), responseData: {} }),
    );
    expect((await h.call("client_list", { realm: "shop" })).isError).toBe(true);
  });
});

describe("client_get", () => {
  it("gets by internal id with scopes and never leaks secrets", async () => {
    h = await start();
    h.kc.clients.findOne.mockResolvedValue(leaky);
    h.kc.clients.listDefaultClientScopes.mockResolvedValue([{ name: "profile" }, {}]);
    h.kc.clients.listOptionalClientScopes.mockResolvedValue([{ name: "phone" }]);
    const result = await h.call("client_get", { realm: "shop", id: "c1" });
    expect(h.kc.clients.findOne).toHaveBeenCalledWith({ realm: "shop", id: "c1" });
    expect(h.kc.clients.listDefaultClientScopes).toHaveBeenCalledWith({ realm: "shop", id: "c1" });
    expect(result.structuredContent).toMatchObject({
      id: "c1",
      clientId: "app",
      rootUrl: "https://app.example.com",
      redirectUris: ["https://app.example.com/*"],
      webOrigins: ["+"],
      defaultClientScopes: ["profile"],
      optionalClientScopes: ["phone"],
    });
    expectNoSecrets(result);
    expect(textOf(result)).not.toContain("secret");
  });

  it("resolves by clientId using an exact match", async () => {
    h = await start();
    h.kc.clients.find.mockResolvedValue([{ id: "x", clientId: "app-2" }, leaky]);
    h.kc.clients.listDefaultClientScopes.mockResolvedValue([]);
    h.kc.clients.listOptionalClientScopes.mockResolvedValue([]);
    const result = await h.call("client_get", { realm: "shop", clientId: "app" });
    expect(h.kc.clients.find).toHaveBeenCalledWith({ realm: "shop", clientId: "app", max: 1 });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { id: string }).id).toBe("c1");
  });

  it("requires exactly one of id / clientId", async () => {
    h = await start();
    expect((await h.call("client_get", { realm: "shop" })).isError).toBe(true);
    expect((await h.call("client_get", { realm: "shop", id: "a", clientId: "b" })).isError).toBe(
      true,
    );
  });

  it("reports an unknown client", async () => {
    h = await start();
    h.kc.clients.findOne.mockResolvedValue(undefined);
    const result = await h.call("client_get", { realm: "shop", id: "ghost" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/was not found.*view-clients/s);
  });
});

describe("path segment guard", () => {
  it("accepts URL-shaped SAML clientIds, which are only sent as query parameters", async () => {
    h = await start();
    const samlId = "https://sp.example.com/saml/metadata";
    h.kc.clients.find.mockResolvedValue([{ ...leaky, id: "c9", clientId: samlId }]);
    h.kc.clients.listDefaultClientScopes.mockResolvedValue([]);
    h.kc.clients.listOptionalClientScopes.mockResolvedValue([]);
    const result = await h.call("client_get", { realm: "demo", clientId: samlId });
    expect(result.isError).toBeFalsy();
    expect(h.kc.clients.find).toHaveBeenCalledWith(
      expect.objectContaining({ realm: "demo", clientId: samlId }),
    );
  });

  it("still rejects dot segments in path fields", async () => {
    h = await startHarness();
    const result = await h.call("user_get", { realm: "demo", userId: ".." });
    expect(result.isError).toBe(true);
    expect(h.kc.users.findOne).not.toHaveBeenCalled();
  });
});
