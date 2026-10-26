import { NetworkError } from "@keycloak/keycloak-admin-client";
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness, textOf } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());

describe("user_search", () => {
  it("passes filters and an explicit realm, requests max+1 rows and detects hasMore", async () => {
    h = await startHarness();
    h.kc.users.find.mockResolvedValue([
      { id: "1", username: "a", email: "a@x.io", attributes: { secret: ["x"] }, credentials: [] },
      { id: "2", username: "b" },
      { id: "3", username: "c" },
    ]);
    const result = await h.call("user_search", { realm: "shop", search: "a", first: 10, max: 2 });
    expect(h.kc.users.find).toHaveBeenCalledWith({
      realm: "shop",
      search: "a",
      first: 10,
      max: 3,
      briefRepresentation: true,
    });
    expect(result.structuredContent).toEqual({
      realm: "shop",
      items: [
        { id: "1", username: "a", email: "a@x.io" },
        { id: "2", username: "b" },
      ],
      first: 10,
      max: 2,
      hasMore: true,
    });
    expect(JSON.stringify(result)).not.toContain("attributes");
    expect(textOf(result)).toMatch(/Found 2 user\(s\) in realm 'shop'/);
  });

  it("uses default pagination and supports exact username/email filters", async () => {
    h = await startHarness();
    h.kc.users.find.mockResolvedValue([]);
    await h.call("user_search", { realm: "shop", username: "bob", email: "b@x.io", exact: true });
    expect(h.kc.users.find).toHaveBeenCalledWith({
      realm: "shop",
      username: "bob",
      email: "b@x.io",
      exact: true,
      first: 0,
      max: 51,
      briefRepresentation: true,
    });
  });

  it("rejects invalid input via schema validation", async () => {
    h = await startHarness();
    const result = await h.call("user_search", { realm: "shop", max: 1000 });
    expect(result.isError).toBe(true);
    expect(h.kc.users.find).not.toHaveBeenCalled();
  });

  it("enforces the realm allowlist and path validation", async () => {
    h = await startHarness({ allowedRealms: ["shop"] });
    const denied = await h.call("user_search", { realm: "other" });
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toMatch(/KEYCLOAK_MCP_REALMS/);
    const traversal = await h.call("user_search", { realm: "../master" });
    expect(traversal.isError).toBe(true);
    expect(h.kc.users.find).not.toHaveBeenCalled();
  });

  it.each(["Shop", "SHOP", "shop2", "shop-b", "sho"])(
    "matches the allowlist exactly and denies %j",
    async (realm) => {
      h = await startHarness({ allowedRealms: ["shop"] });
      const result = await h.call("user_search", { realm });
      expect(result.isError).toBe(true);
      expect(h.kc.users.find).not.toHaveBeenCalled();
    },
  );

  it("maps a 404 to a readable error", async () => {
    h = await startHarness();
    h.kc.users.find.mockRejectedValue(
      new NetworkError("404", { response: new Response(null, { status: 404 }), responseData: {} }),
    );
    const result = await h.call("user_search", { realm: "nope" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Not found/);
  });

  it("writes an audit log line without arguments", async () => {
    h = await startHarness();
    h.kc.users.find.mockResolvedValue([]);
    await h.call("user_search", { realm: "shop", search: "sensitive-needle" });
    const line = h.logs.find((l) => l.includes("tool_call"));
    expect(line).toContain("user_search");
    expect(line).toContain("shop");
    expect(line).not.toContain("sensitive-needle");
  });
});

describe("user_create", () => {
  it("creates an enabled user in the given realm", async () => {
    h = await startHarness();
    h.kc.users.create.mockResolvedValue({ id: "new-id" });
    const result = await h.call("user_create", {
      realm: "shop",
      username: "alice",
      email: "alice@example.com",
      firstName: "Alice",
      confirm: true,
    });
    expect(h.kc.users.create).toHaveBeenCalledWith({
      realm: "shop",
      username: "alice",
      enabled: true,
      email: "alice@example.com",
      firstName: "Alice",
    });
    expect(result.structuredContent).toEqual({ id: "new-id", username: "alice", realm: "shop" });
  });

  it("reports conflicts", async () => {
    h = await startHarness();
    h.kc.users.create.mockRejectedValue(
      new NetworkError("409", {
        response: new Response(null, { status: 409 }),
        responseData: { errorMessage: "User exists with same username" },
      }),
    );
    const result = await h.call("user_create", { realm: "shop", username: "alice", confirm: true });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("User exists with same username");
  });

  it("rejects an invalid e-mail address", async () => {
    h = await startHarness();
    const result = await h.call("user_create", { realm: "shop", username: "a", email: "nope" });
    expect(result.isError).toBe(true);
    expect(h.kc.users.create).not.toHaveBeenCalled();
  });

  it("is blocked in master unless allowed", async () => {
    h = await startHarness();
    const blocked = await h.call("user_create", { realm: "master", username: "x" });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toMatch(/ALLOW_MASTER_WRITE/);
    expect(h.kc.users.create).not.toHaveBeenCalled();
    await h.close();

    h = await startHarness({ allowMasterWrite: true });
    h.kc.users.create.mockResolvedValue({ id: "i" });
    const allowed = await h.call("user_create", { realm: "master", username: "x", confirm: true });
    expect(allowed.isError).toBeFalsy();
  });
});

describe("user_delete", () => {
  it("does not delete without confirmation and shows a preview", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob" });
    const result = await h.call("user_delete", { realm: "shop", userId: "u1" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/delete user "bob".*confirm: true/s);
    expect(h.kc.users.del).not.toHaveBeenCalled();
  });

  it("treats confirm: false like a missing confirmation", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob" });
    const result = await h.call("user_delete", { realm: "shop", userId: "u1", confirm: false });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Confirmation required/);
    expect(h.kc.users.del).not.toHaveBeenCalled();
  });

  it("deletes with confirm: true", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob" });
    h.kc.users.del.mockResolvedValue(undefined);
    const result = await h.call("user_delete", { realm: "shop", userId: "u1", confirm: true });
    expect(result.isError).toBeFalsy();
    expect(h.kc.users.del).toHaveBeenCalledWith({ realm: "shop", id: "u1" });
    expect(result.structuredContent).toEqual({ deleted: true, userId: "u1", realm: "shop" });
  });

  it("skips confirmation when KEYCLOAK_MCP_REQUIRE_CONFIRMATION=false", async () => {
    h = await startHarness({ requireConfirmation: false });
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob" });
    h.kc.users.del.mockResolvedValue(undefined);
    const result = await h.call("user_delete", { realm: "shop", userId: "u1" });
    expect(result.isError).toBeFalsy();
  });

  it("reports an unknown user in the preview", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue(undefined);
    const result = await h.call("user_delete", { realm: "shop", userId: "ghost" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/does not exist/);
  });

  it("rejects path traversal in userId and master writes", async () => {
    h = await startHarness();
    const traversal = await h.call("user_delete", { realm: "shop", userId: "../x", confirm: true });
    expect(traversal.isError).toBe(true);
    const master = await h.call("user_delete", { realm: "master", userId: "u", confirm: true });
    expect(master.isError).toBe(true);
    expect(h.kc.users.del).not.toHaveBeenCalled();
  });
});

describe("user_get", () => {
  it("returns a safe subset of one user", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({
      id: "u1",
      username: "bob",
      email: "b@x.io",
      enabled: true,
      createdTimestamp: 123,
      requiredActions: ["UPDATE_PASSWORD"],
      totp: false,
      attributes: { secret: ["x"] },
      credentials: [{ type: "password" }],
    });
    const result = await h.call("user_get", { realm: "shop", userId: "u1" });
    expect(h.kc.users.findOne).toHaveBeenCalledWith({ realm: "shop", id: "u1" });
    expect(result.structuredContent).toEqual({
      id: "u1",
      username: "bob",
      email: "b@x.io",
      enabled: true,
      createdTimestamp: 123,
      requiredActions: ["UPDATE_PASSWORD"],
      totp: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/attributes|credentials/);
  });

  it("returns only allowlisted keys of a full representation", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({
      id: "u1",
      username: "bob",
      access: { manage: true },
      notBefore: 1,
      attributes: { a: ["x"] },
      credentials: [{ value: "pw" }],
      federatedIdentities: [{ userId: "x" }],
      serviceAccountClientId: "c",
      realmRoles: ["admin"],
      clientRoles: { c: ["r"] },
      groups: ["/g"],
      self: "s",
      disableableCredentialTypes: ["otp"],
      clientConsents: [{}],
    });
    const result = await h.call("user_get", { realm: "shop", userId: "u1" });
    expect(Object.keys(result.structuredContent ?? {}).sort()).toEqual(["id", "username"]);
  });

  it("returns isError for an unknown user and honours the allowlist", async () => {
    h = await startHarness({ allowedRealms: ["shop"] });
    h.kc.users.findOne.mockResolvedValue(undefined);
    const missing = await h.call("user_get", { realm: "shop", userId: "ghost" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/does not exist/);
    const denied = await h.call("user_get", { realm: "other", userId: "u" });
    expect(denied.isError).toBe(true);
  });
});

describe("user_update", () => {
  it("sends only the changed fields, not the current representation", async () => {
    h = await startHarness();
    const current = {
      id: "u1",
      username: "bob",
      email: "old@x.io",
      attributes: { dept: ["it"] },
      enabled: true,
    };
    h.kc.users.findOne.mockResolvedValue(current);
    h.kc.users.update.mockResolvedValue(undefined);
    const result = await h.call("user_update", {
      realm: "shop",
      userId: "u1",
      email: "new@x.io",
      enabled: false,
      confirm: true,
    });
    expect(h.kc.users.update).toHaveBeenCalledWith(
      { realm: "shop", id: "u1" },
      { email: "new@x.io", enabled: false, emailVerified: false },
    );
    expect(result.structuredContent).toEqual({
      userId: "u1",
      realm: "shop",
      updatedFields: ["email", "enabled", "emailVerified"],
    });
  });

  it("requires at least one field", async () => {
    h = await startHarness();
    const result = await h.call("user_update", { realm: "shop", userId: "u1" });
    expect(result.isError).toBe(true);
    expect(h.kc.users.update).not.toHaveBeenCalled();
  });

  it("fails for an unknown user and does not write", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue(undefined);
    const result = await h.call("user_update", {
      realm: "shop",
      userId: "ghost",
      enabled: true,
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(h.kc.users.update).not.toHaveBeenCalled();
  });

  it("is blocked in master and rejects invalid e-mail", async () => {
    h = await startHarness();
    const master = await h.call("user_update", { realm: "master", userId: "u", enabled: true });
    expect(textOf(master)).toMatch(/ALLOW_MASTER_WRITE/);
    const bad = await h.call("user_update", { realm: "shop", userId: "u", email: "nope" });
    expect(bad.isError).toBe(true);
    expect(h.kc.users.update).not.toHaveBeenCalled();
  });
});

describe("user_send_actions_email", () => {
  it("sends the e-mail with explicit realm and options", async () => {
    h = await startHarness();
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob", email: "bob@x.io" });
    h.kc.users.executeActionsEmail.mockResolvedValue(undefined);
    const result = await h.call("user_send_actions_email", {
      realm: "shop",
      userId: "u1",
      actions: ["UPDATE_PASSWORD", "VERIFY_EMAIL"],
      lifespan: 3600,
      clientId: "web",
      redirectUri: "https://app.example/cb",
      confirm: true,
    });
    expect(h.kc.users.executeActionsEmail).toHaveBeenCalledWith({
      realm: "shop",
      id: "u1",
      actions: ["UPDATE_PASSWORD", "VERIFY_EMAIL"],
      lifespan: 3600,
      clientId: "web",
      redirectUri: "https://app.example/cb",
    });
    expect(result.structuredContent).toEqual({
      sent: true,
      userId: "u1",
      realm: "shop",
      actions: ["UPDATE_PASSWORD", "VERIFY_EMAIL"],
    });
  });

  it("rejects unknown actions and surfaces Keycloak errors", async () => {
    h = await startHarness();
    const bad = await h.call("user_send_actions_email", {
      realm: "shop",
      userId: "u1",
      actions: ["DROP_TABLE"],
    });
    expect(bad.isError).toBe(true);
    h.kc.users.executeActionsEmail.mockRejectedValue(
      new NetworkError("500", {
        response: new Response(null, { status: 500 }),
        responseData: { errorMessage: "Failed to send execute actions email" },
      }),
    );
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob", email: "bob@x.io" });
    const failed = await h.call("user_send_actions_email", {
      realm: "shop",
      userId: "u1",
      actions: ["VERIFY_EMAIL"],
      confirm: true,
    });
    expect(failed.isError).toBe(true);
  });
});
