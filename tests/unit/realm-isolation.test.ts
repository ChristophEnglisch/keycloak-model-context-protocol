import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeycloakAdminGateway } from "../../src/keycloak/gateway.js";
import { silentLogger } from "../../src/logging.js";
import { createServer } from "../../src/server.js";
import { makeConfig } from "../helpers/fakes.js";
import { fakeJwt } from "../helpers/jwt.js";

/**
 * Regression for the v0.0.x realm leak: the old code called setConfig({ realmName })
 * on a shared client, so later token requests went to the target realm.
 * This test uses the REAL admin client against a stubbed fetch.
 */
describe("realm isolation (real admin client, stubbed HTTP)", () => {
  const requests: { method: string; path: string }[] = [];

  beforeEach(() => {
    requests.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        requests.push({ method, path: url.pathname });
        // Yield so concurrent calls interleave.
        await new Promise((resolve) => setTimeout(resolve, 5));
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        if (url.pathname.endsWith("/protocol/openid-connect/token")) {
          return json({
            access_token: fakeJwt(Math.floor(Date.now() / 1000) + 300),
            expires_in: 300,
          });
        }
        const realm = /\/admin\/realms\/([^/]+)\/users/.exec(url.pathname)?.[1];
        if (realm) return json([{ id: `id-${realm}`, username: `user-in-${realm}` }]);
        return json([]);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes parallel calls to the right realm and always logs in at the auth realm", async () => {
    const config = makeConfig({ url: "http://kc.test" });
    const gateway = new KeycloakAdminGateway(config, { logger: silentLogger });
    const server = createServer({ config, gateway, logger: silentLogger });
    const client = new Client({ name: "t", version: "0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const names = ["alpha", "beta", "alpha", "gamma", "beta"];
    const results = await Promise.all(
      names.map((realm) => client.callTool({ name: "user_search", arguments: { realm } })),
    );

    results.forEach((result, i) => {
      expect(result.isError).toBeFalsy();
      const content = result.structuredContent as { realm: string; items: { username: string }[] };
      expect(content.realm).toBe(names[i]);
      expect(content.items[0]?.username).toBe(`user-in-${names[i]}`);
    });

    const tokenCalls = requests.filter((r) => r.path.includes("/protocol/openid-connect/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]?.path).toBe("/realms/master/protocol/openid-connect/token");
    const userPaths = requests
      .filter((r) => r.path.includes("/users"))
      .map((r) => r.path.replace(/\/$/, ""));
    expect(userPaths.sort()).toEqual(names.map((realm) => `/admin/realms/${realm}/users`).sort());

    // A later call after realm switching still does not re-login against a target realm.
    await client.callTool({ name: "realm_list", arguments: {} });
    expect(
      requests.filter((r) => r.path.includes("/protocol/openid-connect/token")).map((r) => r.path),
    ).toEqual(["/realms/master/protocol/openid-connect/token"]);

    await client.close();
    await server.close();
  });

  it("logs in at the configured auth realm", async () => {
    const config = makeConfig({ url: "http://kc.test", authRealm: "ops" });
    const gateway = new KeycloakAdminGateway(config, { logger: silentLogger });
    const server = createServer({ config, gateway, logger: silentLogger });
    const client = new Client({ name: "t", version: "0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    await client.callTool({ name: "user_search", arguments: { realm: "shop" } });
    expect(
      requests.filter((r) => r.path.includes("/protocol/openid-connect/token")).map((r) => r.path),
    ).toEqual(["/realms/ops/protocol/openid-connect/token"]);

    await client.close();
    await server.close();
  });
});
