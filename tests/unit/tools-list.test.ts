import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());

describe("tools/list", () => {
  it("publishes title, descriptions, outputSchema and correct annotations", async () => {
    h = await startHarness();
    const { tools } = await h.client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(
      [
        "realm_list",
        "realm_get",
        "user_search",
        "user_get",
        "user_create",
        "user_update",
        "user_delete",
        "user_send_actions_email",
        "group_list",
        "group_members_list",
        "user_group_add",
        "user_group_remove",
        "role_list",
        "user_roles_list",
        "user_role_assign",
        "user_role_revoke",
      ].sort(),
    );

    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.openWorldHint).toBe(false);
      const props = (tool.inputSchema as { properties: Record<string, { description?: string }> })
        .properties;
      for (const [field, schema] of Object.entries(props)) {
        expect(schema.description, `${tool.name}.${field} needs a description`).toBeTruthy();
      }
    }

    expect(byName.realm_list?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(byName.user_search?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
    expect(byName.user_create?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(byName.user_delete?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
  });

  it("annotates the groups, roles and extended core tools", async () => {
    h = await startHarness();
    const { tools } = await h.client.listTools();
    const ann = (name: string) => tools.find((t) => t.name === name)?.annotations;
    for (const name of [
      "realm_get",
      "user_get",
      "group_list",
      "group_members_list",
      "role_list",
      "user_roles_list",
    ]) {
      expect(ann(name), name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
    // Sensitive writes are announced as destructive so clients ask before them.
    expect(ann("user_update")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(ann("user_send_actions_email")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(ann("user_group_add")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(ann("user_role_assign")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    for (const name of ["user_group_remove", "user_role_revoke"]) {
      expect(ann(name), name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      });
    }
  });

  it("adds an optional confirm parameter to every tool that changes data", async () => {
    h = await startHarness();
    const { tools } = await h.client.listTools();
    const schema = (name: string) =>
      tools.find((t) => t.name === name)?.inputSchema as {
        properties: Record<string, unknown>;
        required?: string[];
      };
    expect(schema("user_delete").properties).toHaveProperty("confirm");
    expect(schema("user_delete").required ?? []).not.toContain("confirm");
    for (const tool of tools) {
      const hasConfirm = "confirm" in schema(tool.name).properties;
      expect(hasConfirm, tool.name).toBe(tool.annotations?.readOnlyHint === false);
      expect(schema(tool.name).required ?? [], tool.name).not.toContain("confirm");
    }
  });

  it("hides write tools in read-only mode", async () => {
    h = await startHarness({ readOnly: true });
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "realm_list",
        "realm_get",
        "user_search",
        "user_get",
        "group_list",
        "group_members_list",
        "role_list",
        "user_roles_list",
      ].sort(),
    );
    await expect(h.call("user_create", { realm: "x", username: "u" })).rejects.toThrow(
      /not found/i,
    );
  });
});
