import { Client } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { Config } from "../../src/config.js";
import { createLogger, type Logger } from "../../src/logging.js";
import { createServer } from "../../src/server.js";
import { createFakeGateway, createFakeKc, type FakeKc, makeConfig } from "./fakes.js";

export interface Harness {
  client: Client;
  kc: FakeKc;
  logs: string[];
  logger: Logger;
  /** Calls a tool and returns the raw result. */
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** Starts createServer() with a fake gateway and connects an SDK client over an in-memory transport. */
export async function startHarness(configOverrides: Partial<Config> = {}): Promise<Harness> {
  const config = makeConfig(configOverrides);
  const { gateway, kc } = createFakeGateway(createFakeKc());
  const logs: string[] = [];
  const logger = createLogger({ level: "debug", write: (line) => logs.push(line) });
  const server = createServer({ config, gateway, logger });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    kc,
    logs,
    logger,
    call: (name, args = {}) =>
      client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: CallToolResult): string {
  return result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}
