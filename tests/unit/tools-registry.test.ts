import { describe, expect, it } from "vitest";
import { selectTools, TOOLSETS } from "../../src/tools/index.js";
import { makeConfig } from "../helpers/fakes.js";

const names = (config = makeConfig()) => selectTools(config).map((t) => t.name);

describe("toolset registry", () => {
  it("exposes core, groups and roles tools by default", () => {
    expect(names()).toEqual([
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
    ]);
  });

  it("wires every toolset (even empty stubs)", () => {
    expect(Object.keys(TOOLSETS).sort()).toEqual(
      ["clients", "core", "events", "groups", "roles", "security", "sessions"].sort(),
    );
  });

  it("filters by KEYCLOAK_MCP_TOOLSETS", () => {
    expect(names(makeConfig({ toolsets: new Set(["groups"]) }))).toEqual([
      "group_list",
      "group_members_list",
      "user_group_add",
      "user_group_remove",
    ]);
    expect(names(makeConfig({ toolsets: new Set(["core"]) })).length).toBe(8);
    expect(names(makeConfig({ toolsets: new Set(["roles"]) })).length).toBe(4);
  });

  it("registers only read tools in read-only mode", () => {
    expect(names(makeConfig({ readOnly: true }))).toEqual([
      "realm_list",
      "realm_get",
      "user_search",
      "user_get",
      "group_list",
      "group_members_list",
      "role_list",
      "user_roles_list",
    ]);
  });

  it("has unique tool names in snake_case", () => {
    const all = Object.values(TOOLSETS)
      .flat()
      .map((t) => t.name);
    expect(new Set(all).size).toBe(all.length);
    for (const name of all) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
  });
});
