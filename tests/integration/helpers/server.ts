import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport } from "@modelcontextprotocol/server";
import { expect } from "vitest";
import { loadConfig } from "../../../src/config.js";
import { KeycloakAdminGateway } from "../../../src/keycloak/gateway.js";
import { silentLogger } from "../../../src/logging.js";
import { createServer } from "../../../src/server.js";
import { CLIENTS, USERS } from "./constants.js";
import { keycloak } from "./context.js";

export type Env = Record<string, string>;

/** Environment for the master admin (password grant, admin-cli). */
export function masterAdminEnv(): Env {
  const k = keycloak();
  return { KEYCLOAK_USERNAME: k.adminUser, KEYCLOAK_PASSWORD: k.adminPassword };
}

export function serviceAccountEnv(realm: string, clientId: string, secret: string): Env {
  return {
    KEYCLOAK_AUTH_REALM: realm,
    KEYCLOAK_CLIENT_ID: clientId,
    KEYCLOAK_CLIENT_SECRET: secret,
  };
}

export const fixtureServiceEnv = (): Env =>
  serviceAccountEnv("it-realm", CLIENTS.service.clientId, CLIENTS.service.secret);

export const fixtureAdminEnv = (): Env => ({
  KEYCLOAK_AUTH_REALM: "it-realm",
  KEYCLOAK_USERNAME: USERS.admin.username,
  KEYCLOAK_PASSWORD: USERS.admin.password,
});

export interface RealServer {
  client: Client;
  /** Raw tool call. */
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** Tool call that must succeed; returns structuredContent. */
  ok<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export function textOf(result: CallToolResult): string {
  return result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

/**
 * createServer() with the real KeycloakAdminGateway against the test Keycloak,
 * connected to an SDK client over an in-memory transport. All toolsets enabled.
 */
export async function startRealServer(env: Env, extra: Env = {}): Promise<RealServer> {
  const config = loadConfig({
    KEYCLOAK_URL: keycloak().url,
    KEYCLOAK_MCP_TOOLSETS: "all",
    KEYCLOAK_MCP_LOG_LEVEL: "error",
    ...env,
    ...extra,
  });
  const gateway = new KeycloakAdminGateway(config);
  const server = createServer({ config, gateway, logger: silentLogger });
  const client = new Client({ name: "integration-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  return {
    client,
    call,
    async ok<T>(name: string, args: Record<string, unknown> = {}) {
      const result = await call(name, args);
      expect(result.isError, `${name} failed: ${textOf(result)}`).not.toBe(true);
      expect(result.structuredContent, `${name} returned no structuredContent`).toBeDefined();
      return result.structuredContent as T;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export interface Page<T> {
  items: T[];
  first: number;
  max: number;
  hasMore: boolean;
}
