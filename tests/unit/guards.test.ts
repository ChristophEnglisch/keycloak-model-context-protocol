import { describe, expect, it } from "vitest";
import {
  assertPathSegment,
  assertRealmAllowed,
  isRealmAllowed,
  requireConfirmation,
} from "../../src/guards.js";
import { ToolError } from "../../src/keycloak/errors.js";

const open = { allowedRealms: [], allowMasterWrite: false };

describe("assertPathSegment", () => {
  it.each(["", ".", "..", "a/b", "a\\b", "../x", "a\nb", "a\u0000b"])("rejects %j", (value) => {
    expect(() => assertPathSegment(value)).toThrow(ToolError);
  });

  it.each(["shop", "my realm", "a.b", "user-1234-uuid"])("accepts %j", (value) => {
    expect(() => assertPathSegment(value)).not.toThrow();
  });
});

describe("assertRealmAllowed", () => {
  it("allows any realm when the allowlist is empty", () => {
    expect(() => assertRealmAllowed(open, "shop", { write: true })).not.toThrow();
  });

  it("enforces the allowlist for reads and writes", () => {
    const policy = { allowedRealms: ["shop"], allowMasterWrite: false };
    expect(() => assertRealmAllowed(policy, "shop", { write: false })).not.toThrow();
    expect(() => assertRealmAllowed(policy, "other", { write: false })).toThrow(
      /KEYCLOAK_MCP_REALMS/,
    );
    expect(isRealmAllowed(policy, "other")).toBe(false);
  });

  it("blocks writes in master unless enabled, but allows reads", () => {
    expect(() => assertRealmAllowed(open, "master", { write: false })).not.toThrow();
    expect(() => assertRealmAllowed(open, "master", { write: true })).toThrow(/ALLOW_MASTER_WRITE/);
    expect(() => assertRealmAllowed(open, "Master", { write: true })).toThrow(/ALLOW_MASTER_WRITE/);
    expect(() =>
      assertRealmAllowed({ ...open, allowMasterWrite: true }, "master", { write: true }),
    ).not.toThrow();
  });

  it("rejects path traversal in realm names", () => {
    expect(() => assertRealmAllowed(open, "../master", { write: false })).toThrow(ToolError);
  });
});

describe("requireConfirmation", () => {
  it("throws with a preview unless confirmed", () => {
    expect(() =>
      requireConfirmation({ requireConfirmation: true }, undefined, "delete X."),
    ).toThrow(/delete X\..*confirm: true/);
    expect(() => requireConfirmation({ requireConfirmation: true }, true, "x")).not.toThrow();
  });

  it("is skipped when confirmation is disabled", () => {
    expect(() => requireConfirmation({ requireConfirmation: false }, undefined, "x")).not.toThrow();
  });
});
