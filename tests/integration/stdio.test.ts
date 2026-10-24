import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, it } from "vitest";
import { VERSION } from "../../src/version.js";
import { CLIENTS, REALM, USERS } from "./helpers/constants.js";
import { describeIt, keycloak } from "./helpers/context.js";

const entry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

type ToolResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: unknown;
};

describeIt("real binary over stdio against a real Keycloak", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let stderr = "";

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: {
        PATH: process.env.PATH ?? "",
        KEYCLOAK_URL: keycloak().url,
        KEYCLOAK_AUTH_REALM: REALM,
        KEYCLOAK_CLIENT_ID: CLIENTS.service.clientId,
        KEYCLOAK_CLIENT_SECRET: CLIENTS.service.secret,
        KEYCLOAK_MCP_TOOLSETS: "all",
        KEYCLOAK_MCP_LOG_LEVEL: "info",
      },
      stderr: "pipe",
    });
    client = new Client({ name: "stdio-it", version: "0.0.0" });
    await client.connect(transport);
    transport.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
  });

  afterAll(async () => {
    await client?.close();
  });

  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args }) as Promise<ToolResult>;

  it("initializes with the package version and lists all 24 tools", async () => {
    expect(client.getServerVersion()?.version).toBe(VERSION);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(24);
  });

  it("serves a read call with the service account", async () => {
    const result = await call("user_search", { realm: REALM, search: USERS.alice.username });
    expect(result.isError).not.toBe(true);
    const page = result.structuredContent as { items: { username: string }[] };
    expect(page.items.map((u) => u.username)).toContain(USERS.alice.username);
  });

  it("maps a missing admin role to a readable 403", async () => {
    // The fixture service account has no view-events role.
    const result = await call("event_list", { realm: REALM });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("HTTP 403");
  });

  it("asks for confirmation before destructive calls", async () => {
    const search = await call("user_search", {
      realm: REALM,
      username: USERS.carol.username,
      exact: true,
    });
    const carol = (search.structuredContent as { items: { id: string }[] }).items[0];
    expect(carol).toBeDefined();
    const result = await call("user_delete", { realm: REALM, userId: carol?.id ?? "" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Confirmation required/);
    // Nothing was deleted.
    const again = await call("user_search", {
      realm: REALM,
      username: USERS.carol.username,
      exact: true,
    });
    expect((again.structuredContent as { items: unknown[] }).items).toHaveLength(1);
  });

  it("reports unknown users before asking for confirmation", async () => {
    const result = await call("user_delete", {
      realm: REALM,
      userId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/does not exist/);
  });

  it("logs to stderr only, without secrets", async () => {
    // give the child a moment to flush the last audit line
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stderr).toContain("tool_call");
    expect(stderr).not.toContain(CLIENTS.service.secret);
  });
});
