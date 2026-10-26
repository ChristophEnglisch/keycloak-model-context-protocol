import { describe, expect, it } from "vitest";
import {
  ConfigError,
  collectSecrets,
  isLoopbackHost,
  loadConfig,
  suggestVariable,
} from "../../src/config.js";

const base = { KEYCLOAK_URL: "http://localhost:8080" };

describe("loadConfig", () => {
  it("requires KEYCLOAK_URL", () => {
    expect(() => loadConfig({ KEYCLOAK_CLIENT_ID: "a", KEYCLOAK_CLIENT_SECRET: "b" })).toThrow(
      /KEYCLOAK_URL/,
    );
  });

  it("has no credential defaults", () => {
    expect(() => loadConfig(base)).toThrow(ConfigError);
    expect(() => loadConfig(base)).toThrow(/No credentials configured/);
  });

  it("rejects non-http URLs", () => {
    expect(() =>
      loadConfig({ KEYCLOAK_URL: "ftp://x", KEYCLOAK_CLIENT_ID: "a", KEYCLOAK_CLIENT_SECRET: "b" }),
    ).toThrow(/KEYCLOAK_URL/);
  });

  it("auto-detects client_credentials when a secret is set", () => {
    const config = loadConfig({
      ...base,
      KEYCLOAK_CLIENT_ID: "mcp",
      KEYCLOAK_CLIENT_SECRET: "secret",
    });
    expect(config.credentials).toEqual({
      grantType: "client_credentials",
      clientId: "mcp",
      clientSecret: "secret",
    });
    expect(config.authRealm).toBe("master");
  });

  it("requires a client id for client_credentials", () => {
    expect(() =>
      loadConfig({
        ...base,
        KEYCLOAK_GRANT_TYPE: "client_credentials",
        KEYCLOAK_CLIENT_SECRET: "x",
      }),
    ).toThrow(/KEYCLOAK_CLIENT_ID/);
  });

  it("auto-detects the password grant and defaults the client to admin-cli", () => {
    const config = loadConfig({ ...base, KEYCLOAK_USERNAME: "u", KEYCLOAK_PASSWORD: "p" });
    expect(config.credentials).toEqual({
      grantType: "password",
      clientId: "admin-cli",
      username: "u",
      password: "p",
    });
  });

  it("requires a password when a username is given", () => {
    expect(() => loadConfig({ ...base, KEYCLOAK_USERNAME: "u" })).toThrow(/KEYCLOAK_PASSWORD/);
  });

  it("accepts legacy aliases with a deprecation warning", () => {
    const config = loadConfig({ ...base, KEYCLOAK_ADMIN: "admin", KEYCLOAK_ADMIN_PASSWORD: "pw" });
    expect(config.credentials).toMatchObject({
      grantType: "password",
      username: "admin",
      password: "pw",
    });
    expect(config.warnings).toHaveLength(2);
    expect(config.warnings.join(" ")).toMatch(/KEYCLOAK_ADMIN is deprecated/);
  });

  it("prefers new variables over legacy aliases without warning", () => {
    const config = loadConfig({
      ...base,
      KEYCLOAK_USERNAME: "new",
      KEYCLOAK_PASSWORD: "newpw",
      KEYCLOAK_ADMIN: "old",
      KEYCLOAK_ADMIN_PASSWORD: "oldpw",
    });
    expect(config.credentials).toMatchObject({ username: "new", password: "newpw" });
    expect(config.warnings).toHaveLength(0);
  });

  it("applies documented defaults", () => {
    const config = loadConfig({ ...base, KEYCLOAK_USERNAME: "u", KEYCLOAK_PASSWORD: "p" });
    expect(config).toMatchObject({
      readOnly: false,
      allowedRealms: [],
      allowMasterWrite: false,
      requireConfirmation: true,
      timeoutMs: 30_000,
      logLevel: "info",
    });
    expect([...config.toolsets]).toEqual(["core", "groups", "roles"]);
  });

  it("parses flags, lists, toolsets and numbers", () => {
    const config = loadConfig({
      ...base,
      KEYCLOAK_CLIENT_ID: "c",
      KEYCLOAK_CLIENT_SECRET: "s",
      KEYCLOAK_MCP_READ_ONLY: "true",
      KEYCLOAK_MCP_REALMS: " a, b ,",
      KEYCLOAK_MCP_ALLOW_MASTER_WRITE: "1",
      KEYCLOAK_MCP_REQUIRE_CONFIRMATION: "false",
      KEYCLOAK_MCP_TOOLSETS: "core,events",
      KEYCLOAK_MCP_TIMEOUT_MS: "5000",
      KEYCLOAK_MCP_LOG_LEVEL: "debug",
      KEYCLOAK_URL: "https://kc.example.com/",
    });
    expect(config).toMatchObject({
      url: "https://kc.example.com",
      readOnly: true,
      allowedRealms: ["a", "b"],
      allowMasterWrite: true,
      requireConfirmation: false,
      timeoutMs: 5000,
      logLevel: "debug",
    });
    expect([...config.toolsets]).toEqual(["core", "events"]);
  });

  it("expands 'all' toolsets and rejects unknown ones", () => {
    const creds = { ...base, KEYCLOAK_CLIENT_ID: "c", KEYCLOAK_CLIENT_SECRET: "s" };
    expect(loadConfig({ ...creds, KEYCLOAK_MCP_TOOLSETS: "all" }).toolsets.size).toBe(7);
    expect(() => loadConfig({ ...creds, KEYCLOAK_MCP_TOOLSETS: "core,bogus" })).toThrow(/bogus/);
  });

  it("expands only the exact word 'all'", () => {
    const creds = { ...base, KEYCLOAK_CLIENT_ID: "c", KEYCLOAK_CLIENT_SECRET: "s" };
    expect(() => loadConfig({ ...creds, KEYCLOAK_MCP_TOOLSETS: "alpha" })).toThrow(/alpha/);
  });

  it("keeps the case of KEYCLOAK_MCP_REALMS entries", () => {
    const config = loadConfig({
      ...base,
      KEYCLOAK_CLIENT_ID: "c",
      KEYCLOAK_CLIENT_SECRET: "s",
      KEYCLOAK_MCP_REALMS: "Shop",
    });
    expect(config.allowedRealms).toEqual(["Shop"]);
  });

  it("names the missing client secret for an explicit client_credentials grant", () => {
    expect(() =>
      loadConfig({ ...base, KEYCLOAK_GRANT_TYPE: "client_credentials", KEYCLOAK_CLIENT_ID: "c" }),
    ).toThrow(/KEYCLOAK_CLIENT_SECRET/);
  });

  it("rejects invalid values and never echoes secrets", () => {
    const creds = { ...base, KEYCLOAK_CLIENT_ID: "c", KEYCLOAK_CLIENT_SECRET: "topsecret" };
    expect(() => loadConfig({ ...creds, KEYCLOAK_MCP_TIMEOUT_MS: "abc" })).toThrow(/TIMEOUT_MS/);
    expect(() => loadConfig({ ...creds, KEYCLOAK_MCP_LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
    expect(() => loadConfig({ ...creds, KEYCLOAK_MCP_READ_ONLY: "maybe" })).toThrow(/READ_ONLY/);
    expect(() => loadConfig({ ...creds, KEYCLOAK_GRANT_TYPE: "implicit" })).toThrow(/GRANT_TYPE/);
    try {
      loadConfig({ ...creds, KEYCLOAK_MCP_TIMEOUT_MS: "abc" });
    } catch (error) {
      expect((error as Error).message).not.toContain("topsecret");
    }
  });

  it("collects secrets for masking", () => {
    const config = loadConfig({ ...base, KEYCLOAK_USERNAME: "u", KEYCLOAK_PASSWORD: "pw" });
    expect(collectSecrets(config)).toEqual(["pw"]);
  });

  it("collects the client secret for masking", () => {
    const service = loadConfig({
      ...base,
      KEYCLOAK_CLIENT_ID: "c",
      KEYCLOAK_CLIENT_SECRET: "cs-xyz",
    });
    expect(collectSecrets(service)).toEqual(["cs-xyz"]);
    const password = loadConfig({
      ...base,
      KEYCLOAK_GRANT_TYPE: "password",
      KEYCLOAK_USERNAME: "u",
      KEYCLOAK_PASSWORD: "pw",
      KEYCLOAK_CLIENT_SECRET: "cs2",
    });
    expect(collectSecrets(password).sort()).toEqual(["cs2", "pw"]);
  });

  it("warns about plain http:// for remote hosts only", () => {
    const creds = { KEYCLOAK_CLIENT_ID: "mcp", KEYCLOAK_CLIENT_SECRET: "s" };
    const warningsFor = (url: string) => loadConfig({ KEYCLOAK_URL: url, ...creds }).warnings;
    for (const url of [
      "http://keycloak.example.com",
      "http://kc127.example.com",
      "http://[2001:db8::1]:8080",
    ]) {
      expect(warningsFor(url).join(), url).toMatch(/plain http:\/\//);
    }
    for (const url of [
      "https://keycloak.example.com",
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://[::1]:8080",
      "http://kc.localhost",
    ]) {
      expect(warningsFor(url), url).toEqual([]);
    }
  });
});

describe("loadConfig: unknown variables", () => {
  const creds = { ...base, KEYCLOAK_CLIENT_ID: "c", KEYCLOAK_CLIENT_SECRET: "s" };

  it.each([
    ["KEYCLOAK_MCP_READONLY", "KEYCLOAK_MCP_READ_ONLY"],
    ["KEYCLOAK_READ_ONLY", "KEYCLOAK_MCP_READ_ONLY"],
    ["KEYCLOAK_MCP_REALM", "KEYCLOAK_MCP_REALMS"],
    ["KEYCLOAK_MCP_TOOLSET", "KEYCLOAK_MCP_TOOLSETS"],
    ["KEYCLOAK_MCP_ALLOW_MASTER_WRITES", "KEYCLOAK_MCP_ALLOW_MASTER_WRITE"],
    ["KEYCLOAK_MCP_REQUIRE_CONFIRM", "KEYCLOAK_MCP_REQUIRE_CONFIRMATION"],
    ["KEYCLOAK_CLIENTID", "KEYCLOAK_CLIENT_ID"],
    ["KEYCLOAK_MCP_TIMEOUT", "KEYCLOAK_MCP_TIMEOUT_MS"],
    ["KEYCLOAK_AUTHREALM", "KEYCLOAK_AUTH_REALM"],
  ])("warns about %s and suggests %s", (name, suggestion) => {
    const config = loadConfig({ ...creds, [name]: "true" });
    expect(config.warnings).toEqual([
      `Unknown variable ${name} is ignored; did you mean ${suggestion}?`,
    ]);
  });

  it("warns without a suggestion when nothing is close", () => {
    const config = loadConfig({ ...creds, KEYCLOAK_VERSION: "26.8" });
    expect(config.warnings).toEqual([
      "Unknown variable KEYCLOAK_VERSION is ignored; it is not a setting of this server.",
    ]);
  });

  it("never prints the value of an unknown variable", () => {
    const config = loadConfig({ ...creds, KEYCLOAK_CLIENT_SECRETT: "very-secret-value" });
    expect(config.warnings.join()).not.toContain("very-secret-value");
    expect(config.warnings.join()).toContain("did you mean KEYCLOAK_CLIENT_SECRET?");
  });

  it("ignores variables without the KEYCLOAK_ prefix and the known ones", () => {
    const config = loadConfig({
      ...creds,
      KC_DB: "mysql",
      KEYCLOAKX: "1",
      PATH: "/bin",
      KEYCLOAK_MCP_READ_ONLY: "false",
    });
    expect(config.warnings).toEqual([]);
  });
});

describe("loadConfig: lists without entries", () => {
  const creds = { ...base, KEYCLOAK_CLIENT_ID: "c", KEYCLOAK_CLIENT_SECRET: "s" };

  it.each([",", " , ", ",,", " ,\t,"])("rejects KEYCLOAK_MCP_REALMS=%j", (value) => {
    expect(() => loadConfig({ ...creds, KEYCLOAK_MCP_REALMS: value })).toThrow(
      /KEYCLOAK_MCP_REALMS: contains no entries/,
    );
  });

  it("rejects KEYCLOAK_MCP_TOOLSETS without entries", () => {
    expect(() => loadConfig({ ...creds, KEYCLOAK_MCP_TOOLSETS: "," })).toThrow(
      /KEYCLOAK_MCP_TOOLSETS: contains no entries/,
    );
  });

  it.each(["", "   "])("treats the blank value %j as unset", (value) => {
    const config = loadConfig({
      ...creds,
      KEYCLOAK_MCP_REALMS: value,
      KEYCLOAK_MCP_TOOLSETS: value,
    });
    expect(config.allowedRealms).toEqual([]);
    expect([...config.toolsets]).toEqual(["core", "groups", "roles"]);
  });
});

describe("loadConfig: KEYCLOAK_URL", () => {
  const creds = { KEYCLOAK_CLIENT_ID: "c", KEYCLOAK_CLIENT_SECRET: "s" };

  it.each([
    "https://user:p4ss-in-url@kc.example.com",
    "https://user@kc.example.com",
    "https://:p4ss-in-url@kc.example.com",
    "http://admin:p4ss-in-url@localhost:8080/auth",
  ])("rejects credentials in %s without echoing them", (url) => {
    let error: unknown;
    try {
      loadConfig({ ...creds, KEYCLOAK_URL: url });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toMatch(/KEYCLOAK_URL: must not contain a user name or password/);
    expect(message).not.toContain("p4ss-in-url");
    expect(message).not.toContain("user@");
  });

  it.each([
    "http://127.evil.example",
    "http://127.0.0.1.nip.io:8080",
    "http://127.corp.example",
    "http://localhost.evil.com",
    "http://0.0.0.0:8080",
    "http://[::ffff:7f00:1]:8080",
    "http://kc127.example.com",
  ])("warns about plain http to the non-loopback host in %s", (url) => {
    expect(loadConfig({ ...creds, KEYCLOAK_URL: url }).warnings.join()).toMatch(
      /plain http:\/\/ for the remote host/,
    );
  });

  it.each([
    "http://127.0.0.1:8080",
    "http://127.1.2.3",
    "http://127.1",
    "http://2130706433",
    "http://[::1]:8080",
    "http://[0:0:0:0:0:0:0:1]",
    "http://localhost",
    "http://LOCALHOST:8080",
    "http://kc.localhost",
  ])("treats %s as loopback", (url) => {
    expect(loadConfig({ ...creds, KEYCLOAK_URL: url }).warnings).toEqual([]);
  });

  it.each([
    ["127.0.0.1", true],
    ["127.255.255.255", true],
    ["128.0.0.1", false],
    ["[::1]", true],
    ["::1", true],
    ["[::2]", false],
    ["127.0.0.1.nip.io", false],
    ["127.evil.example", false],
    ["localhost", true],
    ["a.localhost", true],
    ["localhost.example", false],
  ])("isLoopbackHost(%j) is %s", (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});

describe("suggestVariable", () => {
  it.each([
    ["KEYCLOAK_MCP_REALMS_ALLOWLIST", "KEYCLOAK_MCP_REALMS"],
    ["KEYCLOAK_MCP_LOGLEVEL", "KEYCLOAK_MCP_LOG_LEVEL"],
    ["KEYCLOAK_PASSWROD", "KEYCLOAK_PASSWORD"],
    ["KEYCLOAK_HOME", undefined],
    ["KEYCLOAK_X", undefined],
  ])("%s -> %s", (name, expected) => {
    expect(suggestVariable(name)).toBe(expected);
  });
});
