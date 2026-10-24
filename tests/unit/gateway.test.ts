import type KcAdminClient from "@keycloak/keycloak-admin-client";
import { NetworkError } from "@keycloak/keycloak-admin-client";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config.js";
import { ToolError } from "../../src/keycloak/errors.js";
import { KeycloakAdminGateway } from "../../src/keycloak/gateway.js";
import { fakeJwt } from "../helpers/jwt.js";

const config: Pick<Config, "url" | "authRealm" | "credentials" | "timeoutMs"> = {
  url: "http://kc.test",
  authRealm: "master",
  credentials: { grantType: "client_credentials", clientId: "mcp", clientSecret: "s" },
  timeoutMs: 1000,
};

function setup(opts: { refresh?: boolean; lifetimeSeconds?: number } = {}) {
  let nowMs = 1_000_000_000_000;
  const lifetime = opts.lifetimeSeconds ?? 300;
  const kc = {
    accessToken: undefined as string | undefined,
    refreshToken: undefined as string | undefined,
    auth: vi.fn(async (_credentials: unknown) => {
      kc.accessToken = fakeJwt(Math.floor(nowMs / 1000) + lifetime);
      kc.refreshToken = opts.refresh ? "refresh" : undefined;
    }),
  };
  const gateway = new KeycloakAdminGateway(config, {
    client: kc as unknown as KcAdminClient,
    now: () => nowMs,
  });
  return { gateway, kc, advance: (ms: number) => (nowMs += ms) };
}

describe("KeycloakAdminGateway", () => {
  it("logs in lazily and caches the token", async () => {
    const { gateway, kc } = setup();
    expect(kc.auth).not.toHaveBeenCalled();
    await gateway.run(async () => 1);
    await gateway.run(async () => 2);
    expect(kc.auth).toHaveBeenCalledTimes(1);
    expect(kc.auth).toHaveBeenCalledWith({
      grantType: "client_credentials",
      clientId: "mcp",
      clientSecret: "s",
    });
  });

  it("logs in only once for parallel calls", async () => {
    const { gateway, kc } = setup();
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => gateway.run(async () => n)));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(kc.auth).toHaveBeenCalledTimes(1);
  });

  it("re-authenticates before the token expires", async () => {
    const { gateway, kc, advance } = setup({ lifetimeSeconds: 100 });
    await gateway.run(async () => 0);
    advance(60_000);
    await gateway.run(async () => 0);
    expect(kc.auth).toHaveBeenCalledTimes(1);
    advance(20_000); // 80s of 100s: inside the 30s skew
    await gateway.run(async () => 0);
    expect(kc.auth).toHaveBeenCalledTimes(2);
  });

  it("uses the refresh token when available", async () => {
    const { gateway, kc, advance } = setup({ refresh: true, lifetimeSeconds: 100 });
    await gateway.run(async () => 0);
    advance(90_000);
    await gateway.run(async () => 0);
    expect(kc.auth).toHaveBeenLastCalledWith(
      expect.objectContaining({ grantType: "refresh_token", refreshToken: "refresh" }),
    );
  });

  it("falls back to a full login when the refresh fails", async () => {
    const { gateway, kc, advance } = setup({ refresh: true, lifetimeSeconds: 100 });
    await gateway.run(async () => 0);
    kc.auth.mockRejectedValueOnce(new Error("refresh token expired"));
    advance(90_000);
    await gateway.run(async () => 0);
    expect(kc.auth).toHaveBeenCalledTimes(3);
    expect(kc.auth).toHaveBeenLastCalledWith(
      expect.objectContaining({ grantType: "client_credentials" }),
    );
  });

  it("retries once after a 401 from the admin API", async () => {
    const { gateway, kc } = setup();
    const unauthorized = new NetworkError("401", {
      response: new Response(null, { status: 401 }),
      responseData: {},
    });
    const fn = vi.fn().mockRejectedValueOnce(unauthorized).mockResolvedValueOnce("ok");
    await expect(gateway.run(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(kc.auth).toHaveBeenCalledTimes(2);
  });

  it("maps API errors to ToolErrors", async () => {
    const { gateway } = setup();
    const notFound = new NetworkError("404", {
      response: new Response(null, { status: 404 }),
      responseData: {},
    });
    await expect(gateway.run(() => Promise.reject(notFound))).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  it("maps login failures and retries login on the next call", async () => {
    const { gateway, kc } = setup();
    kc.auth.mockRejectedValueOnce(
      new NetworkError("401", {
        response: new Response(null, { status: 401 }),
        responseData: { error: "invalid_client" },
      }),
    );
    const fn = vi.fn(async () => "ok");
    const failure = await gateway.run(fn).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ToolError);
    expect((failure as ToolError).message).toMatch(
      /Authentication against Keycloak realm 'master'/,
    );
    expect(fn).not.toHaveBeenCalled();
    await expect(gateway.run(fn)).resolves.toBe("ok");
  });
});
