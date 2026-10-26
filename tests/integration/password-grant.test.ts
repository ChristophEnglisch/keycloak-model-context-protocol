import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { KeycloakAdminGateway } from "../../src/keycloak/gateway.js";
import { createLogger } from "../../src/logging.js";
import { adminClient, createUser, deleteUsersByPrefix, passwordLogin } from "./helpers/admin.js";
import { REALM } from "./helpers/constants.js";
import { describeIt, keycloak } from "./helpers/context.js";

// it-realm has brute force detection on: 3 failures lock an account for 15 minutes.
const PREFIX = "it-pwgrant";
const PASSWORD = "it-pwgrant-password";

describeIt("password grant against a real Keycloak", () => {
  let user: { id: string; username: string };
  const logs: string[] = [];

  beforeEach(async () => {
    user = await createUser(REALM, PREFIX);
    const kc = await adminClient();
    await kc.users.resetPassword({
      realm: REALM,
      id: user.id,
      credential: { type: "password", value: PASSWORD, temporary: false },
    });
    // The account needs some admin role so that the gateway's calls succeed.
    const [management] = await kc.clients.find({ realm: REALM, clientId: "realm-management" });
    const viewUsers = await kc.clients.findRole({
      realm: REALM,
      id: management?.id ?? "",
      roleName: "view-users",
    });
    await kc.users.addClientRoleMappings({
      realm: REALM,
      id: user.id,
      clientUniqueId: management?.id ?? "",
      roles: [{ id: viewUsers?.id ?? "", name: "view-users" }],
    });
    logs.length = 0;
  });

  afterEach(async () => {
    await deleteUsersByPrefix(REALM, PREFIX);
  });

  function gateway(password: string) {
    const config = loadConfig({
      KEYCLOAK_URL: keycloak().url,
      KEYCLOAK_AUTH_REALM: REALM,
      KEYCLOAK_USERNAME: user.username,
      KEYCLOAK_PASSWORD: password,
    });
    return new KeycloakAdminGateway(config, {
      logger: createLogger({ level: "debug", write: (line) => logs.push(line) }),
    });
  }

  async function failures(): Promise<number> {
    const kc = await adminClient();
    const status = await kc.attackDetection.findOne({ realm: REALM, id: user.id });
    return Number(status?.numFailures ?? 0);
  }

  it("a wrong password costs one login attempt, not one per call", async () => {
    const gw = gateway("wrong-password");
    const messages: string[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push(
        await gw.run(async () => "unexpected").catch((error: Error) => `${error.message}`),
      );
    }
    expect(messages[0]).toMatch(/Authentication against Keycloak realm 'it-realm' failed/);
    expect(messages[0]).toMatch(/next login attempt is allowed in 30 s/);
    for (const message of messages.slice(1)) expect(message).toMatch(/No new login attempt/);
    expect(await failures()).toBe(1);
    // The account is not locked: the right password still works.
    expect(await passwordLogin(REALM, user.username, PASSWORD)).toBe(200);
  });

  it("a locked account is named as a possible cause", async () => {
    for (let i = 0; i < 3; i++) await passwordLogin(REALM, user.username, "wrong-password");
    const gw = gateway(PASSWORD);
    const message = await gw.run(async () => "unexpected").catch((error: Error) => error.message);
    expect(message).toMatch(/may be locked by brute force detection in realm 'it-realm'/);
    expect(message).not.toContain(PASSWORD);
  });

  it("close() ends the session of the password grant", async () => {
    const kc = await adminClient();
    const sessions = async () =>
      (await kc.users.listSessions({ realm: REALM, id: user.id })).length;
    const gw = gateway(PASSWORD);
    await gw.run((client) => client.users.find({ realm: REALM, max: 1 }));
    expect(await sessions()).toBe(1);
    await gw.close();
    expect(await sessions()).toBe(0);
    expect(logs.join("\n")).toMatch(/Ended the Keycloak session of the password grant/);
  });

  it("the binary ends its session when the client closes stdin", async () => {
    const entry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: {
        PATH: process.env.PATH ?? "",
        KEYCLOAK_URL: keycloak().url,
        KEYCLOAK_AUTH_REALM: REALM,
        KEYCLOAK_USERNAME: user.username,
        KEYCLOAK_PASSWORD: PASSWORD,
        KEYCLOAK_MCP_READ_ONLY: "true",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "pwgrant-it", version: "0.0.0" });
    await client.connect(transport);
    const result = await client.callTool({ name: "user_search", arguments: { realm: REALM } });
    expect(result.isError).not.toBe(true);
    const kc = await adminClient();
    const sessions = async () =>
      (await kc.users.listSessions({ realm: REALM, id: user.id })).length;
    expect(await sessions()).toBe(1);
    await client.close();
    let left = await sessions();
    for (let i = 0; i < 25 && left > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      left = await sessions();
    }
    expect(left).toBe(0);
  });
});
