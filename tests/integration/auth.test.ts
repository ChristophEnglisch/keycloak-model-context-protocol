import { afterEach, expect, it } from "vitest";
import { CLIENTS, REALM, USERS } from "./helpers/constants.js";
import { describeIt } from "./helpers/context.js";
import {
  fixtureAdminEnv,
  fixtureServiceEnv,
  masterAdminEnv,
  type Page,
  type RealServer,
  startRealServer,
  textOf,
} from "./helpers/server.js";

describeIt("authentication against a real Keycloak", () => {
  let server: RealServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("client_credentials with a service account", async () => {
    server = await startRealServer(fixtureServiceEnv());
    const realm = await server.ok<{ realm: string }>("realm_get", { realm: REALM });
    expect(realm.realm).toBe(REALM);
    const users = await server.ok<Page<{ username: string }>>("user_search", { realm: REALM });
    expect(users.items.length).toBeGreaterThan(0);
  });

  it("password grant as a realm admin (login realm = target realm, default admin-cli)", async () => {
    server = await startRealServer(fixtureAdminEnv());
    const users = await server.ok<Page<{ username: string }>>("user_search", {
      realm: REALM,
      search: "alice",
    });
    expect(users.items.map((u) => u.username)).toContain("alice");
  });

  it("password grant as master admin sees all realms", async () => {
    server = await startRealServer(masterAdminEnv());
    const page = await server.ok<Page<{ realm: string }>>("realm_list", {});
    expect(page.items.map((r) => r.realm)).toEqual(expect.arrayContaining(["master", REALM]));
  });

  it("reuses the cached token across repeated calls", async () => {
    server = await startRealServer(fixtureServiceEnv());
    for (let i = 0; i < 5; i++) await server.ok("realm_get", { realm: REALM });
  });

  it("wrong password gives a readable error without leaking the password", async () => {
    const wrong = "definitely-not-the-password";
    server = await startRealServer({
      ...fixtureAdminEnv(),
      KEYCLOAK_PASSWORD: wrong,
    });
    const result = await server.call("user_search", { realm: REALM });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/Authentication against Keycloak realm 'it-realm' failed/);
    expect(text).not.toContain(wrong);
    expect(text).not.toContain(USERS.admin.password);
  });

  it("wrong client secret gives a readable error without leaking the secret", async () => {
    const wrong = "definitely-not-the-secret";
    server = await startRealServer({
      ...fixtureServiceEnv(),
      KEYCLOAK_CLIENT_SECRET: wrong,
    });
    const result = await server.call("realm_get", { realm: REALM });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/Authentication against Keycloak realm 'it-realm' failed/);
    expect(text).not.toContain(wrong);
    expect(text).not.toContain(CLIENTS.service.secret);
  });

  it("unknown auth realm is reported as such", async () => {
    server = await startRealServer({
      ...fixtureServiceEnv(),
      KEYCLOAK_AUTH_REALM: "no-such-realm",
    });
    const result = await server.call("realm_get", { realm: REALM });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no-such-realm/);
  });
});
