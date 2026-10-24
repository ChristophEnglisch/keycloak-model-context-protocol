import { NetworkError } from "@keycloak/keycloak-admin-client";
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness, textOf } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());
const start = (o = {}) => startHarness({ toolsets: new Set(["events"]), ...o });

describe("event_list", () => {
  it("passes filters, paginates and strips token-like details", async () => {
    h = await start();
    h.kc.realms.findEvents.mockResolvedValue([
      {
        time: 0,
        type: "LOGIN",
        userId: "u1",
        clientId: "app",
        ipAddress: "1.1.1.1",
        details: { username: "bob", refresh_token: "RT-SECRET", code: "AUTHCODE", code_id: "cid" },
      },
      { type: "LOGIN_ERROR", error: "invalid_user_credentials" },
    ]);
    const result = await h.call("event_list", {
      realm: "shop",
      type: ["LOGIN", "LOGIN_ERROR"],
      user: "u1",
      dateFrom: "2026-01-01",
      max: 1,
    });
    expect(h.kc.realms.findEvents).toHaveBeenCalledWith({
      realm: "shop",
      first: 0,
      max: 2,
      type: ["LOGIN", "LOGIN_ERROR"],
      user: "u1",
      dateFrom: "2026-01-01",
    });
    const data = result.structuredContent as { items: unknown[]; hasMore: boolean };
    expect(data.hasMore).toBe(true);
    expect(data.items[0]).toEqual({
      time: "1970-01-01T00:00:00.000Z",
      type: "LOGIN",
      userId: "u1",
      clientId: "app",
      ipAddress: "1.1.1.1",
      details: { username: "bob", code_id: "cid" },
    });
    expect(JSON.stringify(result)).not.toMatch(/RT-SECRET|AUTHCODE/);
  });

  it("hints at disabled events when the list is empty", async () => {
    h = await start();
    h.kc.realms.findEvents.mockResolvedValue([]);
    const result = await h.call("event_list", { realm: "shop" });
    expect(textOf(result)).toMatch(/events may be disabled/);
  });

  it("rejects bad dates, disallowed realms and maps 404", async () => {
    h = await start({ allowedRealms: ["shop"] });
    expect((await h.call("event_list", { realm: "shop", dateFrom: "yesterday" })).isError).toBe(
      true,
    );
    expect((await h.call("event_list", { realm: "x" })).isError).toBe(true);
    expect(h.kc.realms.findEvents).not.toHaveBeenCalled();
    h.kc.realms.findEvents.mockRejectedValue(
      new NetworkError("404", { response: new Response(null, { status: 404 }), responseData: {} }),
    );
    expect((await h.call("event_list", { realm: "shop" })).isError).toBe(true);
  });
});

describe("admin_event_list", () => {
  it("maps events without the representation payload", async () => {
    h = await start();
    h.kc.realms.findAdminEvents.mockResolvedValue([
      {
        time: 1000,
        operationType: "UPDATE",
        resourceType: "CLIENT",
        resourcePath: "clients/c1",
        representation: '{"secret":"REP-SECRET"}',
        authDetails: {
          userId: "a1",
          realmId: "master",
          clientId: "admin-cli",
          ipAddress: "2.2.2.2",
        },
      },
      { operationType: "DELETE" },
    ]);
    const result = await h.call("admin_event_list", {
      realm: "shop",
      operationTypes: ["UPDATE"],
      resourceTypes: ["CLIENT"],
      authUser: "a1",
      dateTo: "2026-02-02",
      max: 1,
    });
    expect(h.kc.realms.findAdminEvents).toHaveBeenCalledWith({
      realm: "shop",
      first: 0,
      max: 2,
      operationTypes: ["UPDATE"],
      resourceTypes: ["CLIENT"],
      authUser: "a1",
      dateTo: "2026-02-02",
    });
    const data = result.structuredContent as { items: unknown[]; hasMore: boolean };
    expect(data.hasMore).toBe(true);
    expect(data.items[0]).toEqual({
      time: "1970-01-01T00:00:01.000Z",
      operationType: "UPDATE",
      resourceType: "CLIENT",
      resourcePath: "clients/c1",
      authDetails: { userId: "a1", realmId: "master", clientId: "admin-cli", ipAddress: "2.2.2.2" },
    });
    expect(JSON.stringify(result)).not.toContain("REP-SECRET");
  });

  it("hints at disabled admin events and honours the allowlist", async () => {
    h = await start({ allowedRealms: ["shop"] });
    h.kc.realms.findAdminEvents.mockResolvedValue([]);
    expect(textOf(await h.call("admin_event_list", { realm: "shop" }))).toMatch(/may be disabled/);
    expect((await h.call("admin_event_list", { realm: "other" })).isError).toBe(true);
  });
});
