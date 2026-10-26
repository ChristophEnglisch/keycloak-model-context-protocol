import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());

const ALL = new Set([
  "core",
  "groups",
  "roles",
  "clients",
  "sessions",
  "events",
  "security",
] as const);
const MINE = {
  client_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  client_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  user_sessions_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  user_logout: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  event_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  admin_event_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  user_brute_force_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  user_brute_force_unlock: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
} as const;

describe("clients/sessions/events/security tools in tools/list", () => {
  it("publish title, outputSchema, field descriptions and annotations", async () => {
    h = await startHarness({ toolsets: ALL });
    const { tools } = await h.client.listTools();
    for (const [name, annotations] of Object.entries(MINE)) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.title).toBeTruthy();
      expect(tool?.description).toBeTruthy();
      expect(tool?.outputSchema).toBeDefined();
      expect(tool?.annotations).toMatchObject({ ...annotations, openWorldHint: false });
      const schema = (tool?.inputSchema ?? { properties: {} }) as {
        properties: Record<string, { description?: string }>;
      };
      const props = schema.properties;
      for (const [field, schema] of Object.entries(props)) {
        expect(schema.description, `${name}.${field}`).toBeTruthy();
      }
    }
    const logout = tools.find((t) => t.name === "user_logout")?.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(logout.properties).toHaveProperty("confirm");
  });

  it("exposes only read tools in read-only mode", async () => {
    h = await startHarness({ toolsets: ALL, readOnly: true });
    const names = (await h.client.listTools()).tools.map((t) => t.name);
    const mine = Object.keys(MINE)
      .filter((n) => names.includes(n))
      .sort();
    expect(mine).toEqual(
      Object.entries(MINE)
        .filter(([, a]) => a.readOnlyHint)
        .map(([n]) => n)
        .sort(),
    );
  });
});
