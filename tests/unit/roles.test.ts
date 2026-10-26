import { afterEach, describe, expect, it } from "vitest";
import { isPrivilegedRole } from "../../src/tools/roles.js";
import { type Harness, startHarness, textOf } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());

describe("role_list", () => {
  it("lists realm roles with search and max+1", async () => {
    h = await startHarness();
    h.kc.roles.find.mockResolvedValue([
      { id: "r1", name: "editor", description: "Edits", composite: false, clientRole: false },
      { id: "r2", name: "viewer" },
    ]);
    const result = await h.call("role_list", { realm: "shop", search: "e", max: 1 });
    expect(h.kc.roles.find).toHaveBeenCalledWith({
      realm: "shop",
      first: 0,
      max: 2,
      briefRepresentation: true,
      search: "e",
    });
    expect(result.structuredContent).toEqual({
      realm: "shop",
      items: [{ name: "editor", description: "Edits", composite: false, clientRole: false }],
      first: 0,
      max: 1,
      hasMore: true,
    });
  });

  it("does not return role attributes", async () => {
    h = await startHarness();
    h.kc.roles.find.mockResolvedValue([{ id: "r1", name: "editor", attributes: { k: ["v"] } }]);
    const result = await h.call("role_list", { realm: "shop" });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.structuredContent)).not.toContain("attributes");
  });

  it("resolves clientId to the internal id and lists client roles", async () => {
    h = await startHarness();
    h.kc.clients.find.mockResolvedValue([{ id: "uuid-1", clientId: "web" }]);
    h.kc.clients.listRoles.mockResolvedValue([
      { name: "a", clientRole: true },
      { name: "b", clientRole: true },
      { name: "bb", clientRole: true },
    ]);
    const result = await h.call("role_list", { realm: "shop", clientId: "web", search: "b" });
    expect(h.kc.clients.find).toHaveBeenCalledWith({ realm: "shop", clientId: "web" });
    expect(h.kc.clients.listRoles).toHaveBeenCalledWith({ realm: "shop", id: "uuid-1" });
    expect(result.structuredContent).toMatchObject({
      clientId: "web",
      items: [
        { name: "b", clientRole: true },
        { name: "bb", clientRole: true },
      ],
      hasMore: false,
    });
  });

  it("errors for an unknown client and respects the allowlist", async () => {
    h = await startHarness({ allowedRealms: ["shop"] });
    h.kc.clients.find.mockResolvedValue([]);
    const missing = await h.call("role_list", { realm: "shop", clientId: "nope" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/Client 'nope' does not exist/);
    const denied = await h.call("role_list", { realm: "other" });
    expect(denied.isError).toBe(true);
  });
});

describe("user_roles_list", () => {
  it("returns direct realm and client mappings", async () => {
    h = await startHarness();
    h.kc.users.listRoleMappings.mockResolvedValue({
      realmMappings: [{ id: "r1", name: "editor" }],
      clientMappings: {
        web: { id: "uuid-1", client: "web", mappings: [{ id: "c1", name: "use" }] },
      },
    });
    const result = await h.call("user_roles_list", { realm: "shop", userId: "u1" });
    expect(h.kc.users.listRoleMappings).toHaveBeenCalledWith({ realm: "shop", id: "u1" });
    expect(result.structuredContent).toEqual({
      realm: "shop",
      userId: "u1",
      effective: false,
      realmRoles: [{ name: "editor" }],
      clientRoles: [{ clientId: "web", roles: [{ name: "use" }] }],
    });
  });

  it("expands composite roles with effective=true", async () => {
    h = await startHarness();
    h.kc.users.listRoleMappings.mockResolvedValue({
      realmMappings: [],
      clientMappings: { web: { id: "uuid-1", client: "web", mappings: [] } },
    });
    h.kc.users.listCompositeRealmRoleMappings.mockResolvedValue([
      { name: "editor" },
      { name: "base" },
    ]);
    h.kc.users.listCompositeClientRoleMappings.mockResolvedValue([{ name: "use" }]);
    const result = await h.call("user_roles_list", {
      realm: "shop",
      userId: "u1",
      effective: true,
    });
    expect(h.kc.users.listCompositeRealmRoleMappings).toHaveBeenCalledWith({
      realm: "shop",
      id: "u1",
    });
    expect(h.kc.users.listCompositeClientRoleMappings).toHaveBeenCalledWith({
      realm: "shop",
      id: "u1",
      clientUniqueId: "uuid-1",
    });
    expect(result.structuredContent).toMatchObject({
      effective: true,
      realmRoles: [{ name: "editor" }, { name: "base" }],
      clientRoles: [{ clientId: "web", roles: [{ name: "use" }] }],
    });
  });

  it("maps a 404 to isError", async () => {
    h = await startHarness();
    h.kc.users.listRoleMappings.mockRejectedValue(new TypeError("fetch failed"));
    const result = await h.call("user_roles_list", { realm: "shop", userId: "u1" });
    expect(result.isError).toBe(true);
  });
});

describe("user_role_assign", () => {
  it("assigns resolved realm roles with explicit realm", async () => {
    h = await startHarness();
    h.kc.roles.findOneByName.mockResolvedValue({ id: "r1", name: "editor" });
    h.kc.users.addRealmRoleMappings.mockResolvedValue(undefined);
    const result = await h.call("user_role_assign", {
      realm: "shop",
      userId: "u1",
      roles: ["editor"],
    });
    expect(h.kc.roles.findOneByName).toHaveBeenCalledWith({ realm: "shop", name: "editor" });
    expect(h.kc.users.addRealmRoleMappings).toHaveBeenCalledWith({
      realm: "shop",
      id: "u1",
      roles: [{ id: "r1", name: "editor" }],
    });
    expect(result.structuredContent).toEqual({
      realm: "shop",
      userId: "u1",
      roles: ["editor"],
      assigned: true,
    });
  });

  it("assigns client roles via clientId lookup", async () => {
    h = await startHarness();
    h.kc.clients.find.mockResolvedValue([{ id: "uuid-1", clientId: "web" }]);
    h.kc.clients.findRole.mockResolvedValue({ id: "c1", name: "use" });
    h.kc.users.addClientRoleMappings.mockResolvedValue(undefined);
    const result = await h.call("user_role_assign", {
      realm: "shop",
      userId: "u1",
      roles: ["use"],
      clientId: "web",
    });
    expect(h.kc.clients.findRole).toHaveBeenCalledWith({
      realm: "shop",
      id: "uuid-1",
      roleName: "use",
    });
    expect(h.kc.users.addClientRoleMappings).toHaveBeenCalledWith({
      realm: "shop",
      id: "u1",
      clientUniqueId: "uuid-1",
      roles: [{ id: "c1", name: "use" }],
    });
    expect(result.structuredContent).toMatchObject({ clientId: "web", assigned: true });
  });

  it("fails clearly on unknown roles without assigning anything", async () => {
    h = await startHarness();
    h.kc.roles.findOneByName.mockImplementation(async (payload) =>
      payload?.name === "editor" ? { id: "r1", name: "editor" } : undefined,
    );
    const result = await h.call("user_role_assign", {
      realm: "shop",
      userId: "u1",
      roles: ["editor", "ghost"],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Unknown role\(s\).*ghost.*Nothing was changed/);
    expect(h.kc.users.addRealmRoleMappings).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", undefined],
    ["create-realm", undefined],
    ["view-users", "realm-management"],
    ["realm-admin", "other"],
    ["manage-users", "other"],
  ])("requires confirm for privileged role %s (client %s)", async (role, clientId) => {
    h = await startHarness();
    h.kc.clients.find.mockResolvedValue([{ id: "uuid-1", clientId }]);
    h.kc.clients.findRole.mockResolvedValue({ id: "c1", name: role });
    h.kc.roles.findOneByName.mockResolvedValue({ id: "r1", name: role });
    h.kc.users.addRealmRoleMappings.mockResolvedValue(undefined);
    h.kc.users.addClientRoleMappings.mockResolvedValue(undefined);
    const args = { realm: "shop", userId: "u1", roles: [role], ...(clientId && { clientId }) };

    const blocked = await h.call("user_role_assign", args);
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toMatch(/administrative role.*confirm: true/s);
    expect(h.kc.users.addRealmRoleMappings).not.toHaveBeenCalled();
    expect(h.kc.users.addClientRoleMappings).not.toHaveBeenCalled();

    const ok = await h.call("user_role_assign", { ...args, confirm: true });
    expect(ok.isError).toBeFalsy();
  });

  it("treats confirm: false like a missing confirmation for privileged roles", async () => {
    h = await startHarness();
    h.kc.roles.findOneByName.mockResolvedValue({ id: "r1", name: "admin" });
    const result = await h.call("user_role_assign", {
      realm: "shop",
      userId: "u1",
      roles: ["admin"],
      confirm: false,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/administrative role.*confirm: true/s);
    expect(h.kc.users.addRealmRoleMappings).not.toHaveBeenCalled();
  });

  it("rejects a dot segment as role name before any lookup", async () => {
    h = await startHarness();
    const result = await h.call("user_role_assign", { realm: "shop", userId: "u1", roles: [".."] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Invalid role name/);
    expect(h.kc.roles.findOneByName).not.toHaveBeenCalled();
    expect(h.kc.users.addRealmRoleMappings).not.toHaveBeenCalled();
  });

  it("does not require confirm for ordinary roles or when confirmation is disabled", async () => {
    h = await startHarness({ requireConfirmation: false });
    h.kc.roles.findOneByName.mockResolvedValue({ id: "r1", name: "admin" });
    h.kc.users.addRealmRoleMappings.mockResolvedValue(undefined);
    const result = await h.call("user_role_assign", {
      realm: "shop",
      userId: "u1",
      roles: ["admin"],
    });
    expect(result.isError).toBeFalsy();
  });

  it("is blocked in master", async () => {
    h = await startHarness();
    const result = await h.call("user_role_assign", { realm: "master", userId: "u", roles: ["x"] });
    expect(result.isError).toBe(true);
    expect(h.kc.users.addRealmRoleMappings).not.toHaveBeenCalled();
  });
});

describe("user_role_revoke", () => {
  it("previews without revoking", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob" });
    const result = await h.call("user_role_revoke", {
      realm: "shop",
      userId: "u1",
      roles: ["editor"],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/remove realm role\(s\) editor from user 'bob'.*confirm: true/s);
    expect(h.kc.users.delRealmRoleMappings).not.toHaveBeenCalled();
  });

  it("revokes realm roles with confirm: true", async () => {
    h = await startHarness();
    h.kc.roles.findOneByName.mockResolvedValue({ id: "r1", name: "editor" });
    h.kc.users.delRealmRoleMappings.mockResolvedValue(undefined);
    const result = await h.call("user_role_revoke", {
      realm: "shop",
      userId: "u1",
      roles: ["editor"],
      confirm: true,
    });
    expect(h.kc.users.delRealmRoleMappings).toHaveBeenCalledWith({
      realm: "shop",
      id: "u1",
      roles: [{ id: "r1", name: "editor" }],
    });
    expect(result.structuredContent).toMatchObject({ revoked: true, roles: ["editor"] });
  });

  it("revokes client roles with confirm: true", async () => {
    h = await startHarness();
    h.kc.clients.find.mockResolvedValue([{ id: "uuid-1", clientId: "web" }]);
    h.kc.clients.findRole.mockResolvedValue({ id: "c1", name: "use" });
    h.kc.users.delClientRoleMappings.mockResolvedValue(undefined);
    await h.call("user_role_revoke", {
      realm: "shop",
      userId: "u1",
      roles: ["use"],
      clientId: "web",
      confirm: true,
    });
    expect(h.kc.users.delClientRoleMappings).toHaveBeenCalledWith({
      realm: "shop",
      id: "u1",
      clientUniqueId: "uuid-1",
      roles: [{ id: "c1", name: "use" }],
    });
  });

  it("rejects a dot segment as client role name even when confirmed", async () => {
    h = await startHarness();
    h.kc.clients.find.mockResolvedValue([{ id: "uuid-1", clientId: "web" }]);
    const result = await h.call("user_role_revoke", {
      realm: "shop",
      userId: "u1",
      roles: [".."],
      clientId: "web",
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Invalid role name/);
    expect(h.kc.clients.findRole).not.toHaveBeenCalled();
    expect(h.kc.users.delClientRoleMappings).not.toHaveBeenCalled();
  });

  it("errors on unknown roles even when confirmed", async () => {
    h = await startHarness();
    h.kc.roles.findOneByName.mockResolvedValue(undefined);
    const result = await h.call("user_role_revoke", {
      realm: "shop",
      userId: "u1",
      roles: ["ghost"],
      confirm: true,
    });
    expect(textOf(result)).toMatch(/Unknown role/);
    expect(h.kc.users.delRealmRoleMappings).not.toHaveBeenCalled();
  });
});

describe("isPrivilegedRole", () => {
  it.each([
    "manage-users",
    "manage-realm",
    "manage-clients",
    "manage-events",
    "manage-authorization",
    "manage-identity-providers",
  ])("treats %s of any client as privileged", (name) => {
    expect(isPrivilegedRole(name, "some-client")).toBe(true);
  });
});
