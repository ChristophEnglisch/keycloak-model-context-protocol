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
 * on first access, so new tools need no changes here.
 */
export function createFakeKc(): FakeKc {
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
    get(_target, name) {
      if (name === "then") return undefined;
      let r = resources.get(name);
      if (!r) {
        r = resource();
        resources.set(name, r);
      }
      return r;
    },
  });
}

export function createFakeGateway(kc: FakeKc = createFakeKc()): {
  gateway: KeycloakGateway;
  kc: FakeKc;
} {
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
