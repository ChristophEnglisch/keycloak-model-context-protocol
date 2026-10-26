import type KcAdminClient from "@keycloak/keycloak-admin-client";
import { type Mock, vi } from "vitest";
import type { Config } from "../../src/config.js";
import type { KeycloakGateway } from "../../src/keycloak/gateway.js";

// biome-ignore lint/suspicious/noExplicitAny: matches any admin-client method signature
type AnyFn = (...args: any[]) => any;
type MockedResource<T> = { [M in keyof T]: T[M] extends AnyFn ? Mock<T[M]> : never };

/** Every resource of the real admin client (users, groups, roles, ...) with every method mocked. */
export type FakeKc = { [R in keyof KcAdminClient]: MockedResource<KcAdminClient[R]> };

/**
 * Fake admin client: `kc.<resource>.<method>` is created lazily as a `vi.fn()`
 * on first access, so new tools need no changes here. Plain properties such as
 * `accessToken` can be set with setAccessToken().
 */
export function createFakeKc(): FakeKc {
  const values = new Map<PropertyKey, unknown>();
  const resources = new Map<PropertyKey, object>();
  const resource = () => {
    const methods = new Map<PropertyKey, Mock>();
    return new Proxy(
      {},
      {
        get(_target, method) {
          if (method === "then") return undefined;
          let fn = methods.get(method);
          if (!fn) {
            fn = vi.fn();
            methods.set(method, fn);
          }
          return fn;
        },
      },
    );
  };
  return new Proxy({} as FakeKc, {
    set(_target, name, value) {
      values.set(name, value);
      return true;
    },
    get(_target, name) {
      if (name === "then") return undefined;
      if (values.has(name)) return values.get(name);
      let r = resources.get(name);
      if (!r) {
        r = resource();
        resources.set(name, r);
      }
      return r;
    },
  });
}

/** Sets the access token the fake client reports, e.g. one built with fakeJwt(). */
export function setAccessToken(kc: FakeKc, token: string): void {
  (kc as unknown as { accessToken: string }).accessToken = token;
}

/**
 * Writes resolve their realm through `realms.findOne` first. By default every
 * realm exists under exactly the name it is asked for (like a case-sensitive
 * database), with the id `id-<name>`; override it to simulate other lookups.
 */
export function createFakeGateway(kc: FakeKc = createFakeKc()): {
  gateway: KeycloakGateway;
  kc: FakeKc;
} {
  kc.realms.findOne.mockImplementation(async (payload) =>
    payload === undefined ? undefined : { id: `id-${payload.realm}`, realm: payload.realm },
  );
  return {
    kc,
    gateway: { run: (fn) => fn(kc as unknown as KcAdminClient) },
  };
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    url: "http://keycloak.test",
    authRealm: "master",
    credentials: { grantType: "client_credentials", clientId: "mcp", clientSecret: "s3cret" },
    readOnly: false,
    allowedRealms: [],
    allowMasterWrite: false,
    toolsets: new Set(["core", "groups", "roles"]),
    requireConfirmation: true,
    timeoutMs: 30_000,
    logLevel: "error",
    warnings: [],
    ...overrides,
  };
}
