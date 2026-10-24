import { NetworkError } from "@keycloak/keycloak-admin-client";
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness, textOf } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());
const start = (o = {}) => startHarness({ toolsets: new Set(["sessions"]), ...o });

describe("user_sessions_list", () => {
  it("lists sessions with client ids", async () => {
    h = await start();
    h.kc.users.listSessions.mockResolvedValue([
      {
        id: "s1",
        ipAddress: "1.2.3.4",
        start: 1,
        lastAccess: 2,
        clients: { uuid1: "app" },
        username: "bob",
      },
    ]);
    const result = await h.call("user_sessions_list", { realm: "shop", userId: "u1" });
    expect(h.kc.users.listSessions).toHaveBeenCalledWith({ realm: "shop", id: "u1" });
    expect(result.structuredContent).toEqual({
      realm: "shop",
      userId: "u1",
      sessions: [{ id: "s1", ipAddress: "1.2.3.4", start: 1, lastAccess: 2, clients: ["app"] }],
    });
  });

  it("enforces the allowlist and maps 404", async () => {
    h = await start({ allowedRealms: ["shop"] });
    expect((await h.call("user_sessions_list", { realm: "x", userId: "u" })).isError).toBe(true);
    h.kc.users.listSessions.mockRejectedValue(
      new NetworkError("404", { response: new Response(null, { status: 404 }), responseData: {} }),
    );
    expect((await h.call("user_sessions_list", { realm: "shop", userId: "u" })).isError).toBe(true);
  });
});

describe("user_logout", () => {
  it("previews username and session count without logging out", async () => {
    h = await start();
    h.kc.users.findOne.mockResolvedValue({ id: "u1", username: "bob" });
    h.kc.users.listSessions.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const result = await h.call("user_logout", { realm: "shop", userId: "u1" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/2 active.*'bob'.*confirm: true/s);
    expect(h.kc.users.logout).not.toHaveBeenCalled();
  });

  it("logs out with confirm: true", async () => {
    h = await start();
    h.kc.users.logout.mockResolvedValue(undefined);
    const result = await h.call("user_logout", { realm: "shop", userId: "u1", confirm: true });
    expect(h.kc.users.logout).toHaveBeenCalledWith({ realm: "shop", id: "u1" });
    expect(result.structuredContent).toEqual({ loggedOut: true, userId: "u1", realm: "shop" });
  });

  it("reports unknown users and blocks master", async () => {
    h = await start();
    h.kc.users.findOne.mockResolvedValue(undefined);
    h.kc.users.listSessions.mockResolvedValue([]);
    const r = await h.call("user_logout", { realm: "shop", userId: "ghost" });
    expect(textOf(r)).toMatch(/does not exist/);
    const m = await h.call("user_logout", { realm: "master", userId: "u", confirm: true });
    expect(m.isError).toBe(true);
    expect(textOf(m)).toMatch(/ALLOW_MASTER_WRITE/);
    expect(h.kc.users.logout).not.toHaveBeenCalled();
  });

  it("maps a 404 from Keycloak", async () => {
    h = await start();
    h.kc.users.logout.mockRejectedValue(
      new NetworkError("404", { response: new Response(null, { status: 404 }), responseData: {} }),
    );
    expect(
      (await h.call("user_logout", { realm: "shop", userId: "u", confirm: true })).isError,
    ).toBe(true);
  });
});
