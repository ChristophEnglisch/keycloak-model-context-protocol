import { NetworkError } from "@keycloak/keycloak-admin-client";
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness, textOf } from "../helpers/harness.js";

let h: Harness;
afterEach(async () => h?.close());
const start = (o = {}) => startHarness({ toolsets: new Set(["security"]), ...o });

describe("user_brute_force_status", () => {
  it("returns the state", async () => {
    h = await start();
    h.kc.attackDetection.findOne.mockResolvedValue({
      disabled: true,
      numFailures: 5,
      lastFailure: 99,
      lastIPFailure: "1.1.1.1",
    });
    const result = await h.call("user_brute_force_status", { realm: "shop", userId: "u1" });
    expect(h.kc.attackDetection.findOne).toHaveBeenCalledWith({ realm: "shop", id: "u1" });
    expect(result.structuredContent).toEqual({
      realm: "shop",
      userId: "u1",
      disabled: true,
      numFailures: 5,
      lastFailure: 99,
      lastIPFailure: "1.1.1.1",
    });
  });

  it("works in master (read) but honours the allowlist", async () => {
    h = await start({ allowedRealms: ["master"] });
    h.kc.attackDetection.findOne.mockResolvedValue({});
    const ok = await h.call("user_brute_force_status", { realm: "master", userId: "u" });
    expect(ok.isError).toBeFalsy();
    expect(ok.structuredContent).toMatchObject({ disabled: false, numFailures: 0 });
    expect((await h.call("user_brute_force_status", { realm: "x", userId: "u" })).isError).toBe(
      true,
    );
  });

  it("maps a 404", async () => {
    h = await start();
    h.kc.attackDetection.findOne.mockRejectedValue(
      new NetworkError("404", { response: new Response(null, { status: 404 }), responseData: {} }),
    );
    expect((await h.call("user_brute_force_status", { realm: "s", userId: "u" })).isError).toBe(
      true,
    );
  });
});

describe("user_brute_force_unlock", () => {
  it("clears the state for the user", async () => {
    h = await start();
    h.kc.attackDetection.del.mockResolvedValue(undefined);
    const result = await h.call("user_brute_force_unlock", { realm: "shop", userId: "u1" });
    expect(h.kc.attackDetection.del).toHaveBeenCalledWith({ realm: "shop", id: "u1" });
    expect(result.structuredContent).toEqual({ unlocked: true, userId: "u1", realm: "shop" });
  });

  it("is blocked in master and for traversal ids", async () => {
    h = await start();
    const m = await h.call("user_brute_force_unlock", { realm: "master", userId: "u" });
    expect(m.isError).toBe(true);
    expect(textOf(m)).toMatch(/ALLOW_MASTER_WRITE/);
    expect(
      (await h.call("user_brute_force_unlock", { realm: "shop", userId: "../x" })).isError,
    ).toBe(true);
    expect(h.kc.attackDetection.del).not.toHaveBeenCalled();
  });
});
