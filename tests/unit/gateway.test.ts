import type KcAdminClient from "@keycloak/keycloak-admin-client";
import { NetworkError } from "@keycloak/keycloak-admin-client";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config.js";
import { ToolError } from "../../src/keycloak/errors.js";
import {
  isMasterSuperuserToken,
  KeycloakAdminGateway,
  LOGIN_BACKOFF_INITIAL_MS,
  LOGIN_BACKOFF_MAX_MS,
} from "../../src/keycloak/gateway.js";
import { createLogger } from "../../src/logging.js";
import { fakeJwt } from "../helpers/jwt.js";

const config: Pick<Config, "url" | "authRealm" | "credentials" | "timeoutMs"> = {
  url: "http://kc.test",
  authRealm: "master",
  credentials: { grantType: "client_credentials", clientId: "mcp", clientSecret: "s" },
  timeoutMs: 1000,
};

const passwordConfig: typeof config = {
  ...config,
  credentials: { grantType: "password", clientId: "admin-cli", username: "svc", password: "pw" },
};

function setup(
  opts: {
    refresh?: boolean;
    lifetimeSeconds?: number;
    config?: typeof config;
    claims?: Record<string, unknown>;
    fetch?: typeof fetch;
  } = {},
) {
  let nowMs = 1_000_000_000_000;
  const lifetime = opts.lifetimeSeconds ?? 300;
  const kc = {
    accessToken: undefined as string | undefined,
    refreshToken: undefined as string | undefined,
    auth: vi.fn(async (_credentials: unknown) => {
      kc.accessToken = fakeJwt(Math.floor(nowMs / 1000) + lifetime, opts.claims);
      kc.refreshToken = opts.refresh ? "refresh" : undefined;
    }),
  };
  const logs: string[] = [];
  const gateway = new KeycloakAdminGateway(opts.config ?? config, {
    client: kc as unknown as KcAdminClient,
    now: () => nowMs,
    logger: createLogger({ level: "debug", write: (line) => logs.push(line) }),
    ...(opts.fetch !== undefined && { fetch: opts.fetch }),
  });
  return { gateway, kc, logs, advance: (ms: number) => (nowMs += ms) };
}

/** The ToolError of a call that must fail. */
const failureOf = (gateway: KeycloakAdminGateway): Promise<ToolError> =>
  gateway
    .run(async () => 0)
    .then(
      () => {
        throw new Error("expected the call to fail");
      },
      (error: unknown) => error as ToolError,
    );

const loginRejected = (status: number, responseData: Record<string, unknown>) =>
  new NetworkError(String(status), {
    response: new Response(null, { status }),
    responseData,
  });

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

  it("treats a token without exp as valid for 60 s minus the skew", async () => {
    let nowMs = 1_000_000;
    const kc = {
      accessToken: undefined as string | undefined,
      auth: vi.fn(async () => {
        kc.accessToken = "opaque";
      }),
    };
    const gateway = new KeycloakAdminGateway(config, {
      client: kc as unknown as KcAdminClient,
      now: () => nowMs,
    });
    await gateway.run(async () => 0);
    nowMs += 31_000;
    await gateway.run(async () => 0);
    expect(kc.auth).toHaveBeenCalledTimes(2);
  });

  it("uses the refresh token of the password grant", async () => {
    const { gateway, kc, advance } = setup({
      refresh: true,
      lifetimeSeconds: 100,
      config: passwordConfig,
    });
    await gateway.run(async () => 0);
    advance(90_000);
    await gateway.run(async () => 0);
    expect(kc.auth).toHaveBeenLastCalledWith(
      expect.objectContaining({ grantType: "refresh_token", refreshToken: "refresh" }),
    );
  });

  it("falls back to a full login when the refresh fails", async () => {
    const { gateway, kc, advance } = setup({
      refresh: true,
      lifetimeSeconds: 100,
      config: passwordConfig,
    });
    await gateway.run(async () => 0);
    kc.auth.mockRejectedValueOnce(new Error("refresh token expired"));
    advance(90_000);
    await gateway.run(async () => 0);
    expect(kc.auth).toHaveBeenCalledTimes(3);
    expect(kc.auth).toHaveBeenLastCalledWith(expect.objectContaining({ grantType: "password" }));
  });

  it("never refreshes for client_credentials, even if a refresh token shows up", async () => {
    const { gateway, kc, advance } = setup({ refresh: true, lifetimeSeconds: 100 });
    await gateway.run(async () => 0);
    advance(90_000);
    await gateway.run(async () => 0);
    expect(kc.auth).toHaveBeenCalledTimes(2);
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

  it("maps login failures and logs in again once the wait is over", async () => {
    const { gateway, kc, advance } = setup();
    kc.auth.mockRejectedValueOnce(loginRejected(401, { error: "invalid_client" }));
    const fn = vi.fn(async () => "ok");
    const failure = await gateway.run(fn).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ToolError);
    expect((failure as ToolError).message).toMatch(
      /Authentication against Keycloak realm 'master'/,
    );
    expect((failure as ToolError).message).toMatch(/next login attempt is allowed in 30 s/);
    expect(fn).not.toHaveBeenCalled();
    advance(LOGIN_BACKOFF_INITIAL_MS);
    await expect(gateway.run(fn)).resolves.toBe("ok");
  });
});

describe("KeycloakAdminGateway: rejected logins", () => {
  it("does not try again on every call while it waits", async () => {
    const { gateway, kc, advance, logs } = setup({ config: passwordConfig });
    kc.auth.mockRejectedValue(
      loginRejected(401, { error: "invalid_grant", error_description: "Invalid user credentials" }),
    );
    await expect(gateway.run(async () => 0)).rejects.toMatchObject({ kind: "auth" });
    for (let i = 0; i < 5; i++) {
      advance(1_000);
      const error = await failureOf(gateway);
      expect(error.kind).toBe("auth");
      expect(error.message).toMatch(/No new login attempt for \d+ s/);
      expect(error.message).toMatch(/Invalid user credentials/);
    }
    expect(kc.auth).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toMatch(/pausing login attempts {"retryInSeconds":30}/);
  });

  it("doubles the wait after each rejection up to the maximum, and resets on success", async () => {
    const { gateway, kc, advance } = setup({ config: passwordConfig });
    kc.auth.mockRejectedValue(loginRejected(400, { error: "invalid_grant" }));
    const waits: number[] = [];
    let wait = LOGIN_BACKOFF_INITIAL_MS;
    for (let i = 0; i < 8; i++) {
      const error = await failureOf(gateway);
      waits.push(Number(/allowed in (\d+) s/.exec(error.message)?.[1]) * 1000);
      advance(waits.at(-1) ?? wait);
      wait = Math.min(wait * 2, LOGIN_BACKOFF_MAX_MS);
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
    expect(kc.auth).toHaveBeenCalledTimes(8);

    kc.auth.mockImplementation(async () => {
      kc.accessToken = fakeJwt(9_999_999_999);
    });
    await expect(gateway.run(async () => "ok")).resolves.toBe("ok");
    kc.accessToken = undefined;
    kc.auth.mockRejectedValue(loginRejected(400, { error: "invalid_grant" }));
    const again = await failureOf(gateway);
    expect(again.message).toMatch(/allowed in 30 s/);
  });

  it("does not wait after network errors", async () => {
    const { gateway, kc } = setup({ config: passwordConfig });
    kc.auth.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(gateway.run(async () => 0)).rejects.toMatchObject({ kind: "network" });
    await expect(gateway.run(async () => "ok")).resolves.toBe("ok");
    expect(kc.auth).toHaveBeenCalledTimes(2);
  });

  it("points out a possible brute force lockout for the password grant", async () => {
    const { gateway, kc } = setup({ config: passwordConfig });
    kc.auth.mockRejectedValue(
      loginRejected(400, { error: "invalid_grant", error_description: "Invalid user credentials" }),
    );
    const error = await failureOf(gateway);
    expect(error.message).toMatch(/may be locked by brute force detection in realm 'master'/);
  });

  it("names a disabled account", async () => {
    const { gateway, kc } = setup({ config: passwordConfig });
    kc.auth.mockRejectedValue(
      loginRejected(400, { error: "invalid_grant", error_description: "Account disabled" }),
    );
    const error = await failureOf(gateway);
    expect(error.message).toMatch(/The account is disabled in realm 'master'/);
    expect(error.message).toMatch(/permanent lockout/);
  });

  it("does not mention lockouts for client_credentials", async () => {
    const { gateway, kc } = setup();
    kc.auth.mockRejectedValue(loginRejected(401, { error: "unauthorized_client" }));
    const error = await failureOf(gateway);
    expect(error.message).not.toMatch(/brute force/);
  });
});

describe("KeycloakAdminGateway: master superuser warning", () => {
  const superuser = {
    iss: "http://kc.test/realms/master",
    realm_access: { roles: ["default-roles-master", "admin", "create-realm"] },
  };

  it("warns once when the password grant signs in as a master admin", async () => {
    const { gateway, logs, advance } = setup({ config: passwordConfig, claims: superuser });
    await gateway.run(async () => 0);
    advance(600_000);
    await gateway.run(async () => 0);
    const warnings = logs.filter((l) => l.includes("superuser of the master realm"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ WARN /);
  });

  it("stays quiet for other accounts and for client_credentials", async () => {
    for (const opts of [
      { config: passwordConfig, claims: { ...superuser, realm_access: { roles: ["x"] } } },
      {
        config: passwordConfig,
        claims: { ...superuser, iss: "http://kc.test/realms/shop" },
      },
      { config, claims: superuser },
    ]) {
      const { gateway, logs } = setup(opts);
      await gateway.run(async () => 0);
      expect(logs.join("\n")).not.toMatch(/superuser/);
    }
  });

  it.each([
    [undefined, false],
    ["not-a-jwt", false],
    [fakeJwt(1, superuser), true],
    [fakeJwt(1, { ...superuser, realm_access: "admin" }), false],
  ])("isMasterSuperuserToken(%j) is %s", (token, expected) => {
    expect(isMasterSuperuserToken(token)).toBe(expected);
  });
});

describe("KeycloakAdminGateway.close", () => {
  function okFetch() {
    return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null));
  }

  it("ends the session of the password grant", async () => {
    const fetchMock = okFetch();
    const { gateway, kc } = setup({
      config: { ...passwordConfig, authRealm: "ops team" },
      refresh: true,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await gateway.run(async () => 0);
    await gateway.close();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://kc.test/realms/ops%20team/protocol/openid-connect/logout");
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toBe("client_id=admin-cli&refresh_token=refresh");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(kc.refreshToken).toBeUndefined();
  });

  it("sends the client secret of a confidential client", async () => {
    const fetchMock = okFetch();
    const { gateway } = setup({
      config: {
        ...passwordConfig,
        credentials: { ...passwordConfig.credentials, clientSecret: "cs" } as Config["credentials"],
      },
      refresh: true,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await gateway.run(async () => 0);
    await gateway.close();
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("client_secret=cs");
  });

  it("does nothing without a session or for client_credentials", async () => {
    const fetchMock = okFetch();
    const idle = setup({ config: passwordConfig, fetch: fetchMock as unknown as typeof fetch });
    await idle.gateway.close();
    const service = setup({ refresh: true, fetch: fetchMock as unknown as typeof fetch });
    await service.gateway.run(async () => 0);
    await service.gateway.close();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, also when Keycloak is unreachable or slow", async () => {
    const failing = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const { gateway, logs } = setup({
      config: passwordConfig,
      refresh: true,
      fetch: failing as unknown as typeof fetch,
    });
    await gateway.run(async () => 0);
    await expect(gateway.close()).resolves.toBeUndefined();
    expect(logs.join("\n")).toMatch(/Logout from Keycloak failed {"error":"TimeoutError"}/);
  });
});
