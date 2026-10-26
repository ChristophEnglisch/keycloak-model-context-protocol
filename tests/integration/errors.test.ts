import { afterAll, beforeAll, expect, it } from "vitest";
import { REALM, USERS } from "./helpers/constants.js";
import { describeIt, keycloak } from "./helpers/context.js";
import { masterAdminEnv, type RealServer, startRealServer, textOf } from "./helpers/server.js";

describeIt("error handling against a real Keycloak", () => {
  let server: RealServer;
  beforeAll(async () => {
    server = await startRealServer(masterAdminEnv());
  });
  afterAll(async () => {
    await server?.close();
  });

  it("404: unknown user", async () => {
    const result = await server.call("user_get", {
      realm: REALM,
      userId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not found|does not exist|404/i);
  });

  it("404: unknown realm", async () => {
    const result = await server.call("user_search", { realm: "no-such-realm" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/404|not found/i);
  });

  it("409: duplicate username in user_create", async () => {
    const result = await server.call("user_create", {
      realm: REALM,
      username: USERS.alice.username,
      confirm: true,
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/Conflict \(HTTP 409\)/);
  });

  it("does not leak credentials or stack traces in any error text", async () => {
    const { adminPassword } = keycloak();
    const results = await Promise.all([
      server.call("user_get", { realm: REALM, userId: "00000000-0000-0000-0000-000000000000" }),
      server.call("user_create", { realm: REALM, username: USERS.alice.username, confirm: true }),
      server.call("user_search", { realm: "no-such-realm" }),
    ]);
    for (const result of results) {
      const text = textOf(result);
      expect(text).not.toContain(adminPassword);
      expect(text).not.toMatch(/\bat .*\.(js|ts):\d+/);
      expect(text).not.toMatch(/Bearer\s+ey/);
    }
  });

  it("rejects invalid arguments with a readable validation error", async () => {
    // Depending on the SDK, schema violations surface as isError results or as protocol errors.
    const outcome = await server
      .call("user_search", { realm: REALM, max: 100_000 })
      .then((result) => result.isError === true)
      .catch(() => true);
    expect(outcome).toBe(true);
  });
});
