import { NetworkError } from "@keycloak/keycloak-admin-client";
import { describe, expect, it } from "vitest";
import { mapKeycloakError, ToolError } from "../../src/keycloak/errors.js";

const http = (status: number, data: unknown = undefined) =>
  new NetworkError(`HTTP ${status}`, {
    response: new Response(null, { status }),
    responseData: data,
  });

describe("mapKeycloakError", () => {
  it.each([
    [401, "auth", /401/],
    [403, "forbidden", /permissions/],
    [404, "not_found", /Not found/],
    [409, "conflict", /Conflict/],
    [400, "bad_request", /invalid/],
    [500, "server", /server error/],
  ])("maps HTTP %i", (status, kind, pattern) => {
    const mapped = mapKeycloakError(http(status));
    expect(mapped.kind).toBe(kind);
    expect(mapped.message).toMatch(pattern);
    expect(mapped.status).toBe(status);
  });

  it("includes Keycloak's error message for conflicts", () => {
    const mapped = mapKeycloakError(http(409, { errorMessage: "User exists with same username" }));
    expect(mapped.message).toContain("User exists with same username");
  });

  it("explains failed logins", () => {
    const mapped = mapKeycloakError(http(401, { error: "invalid_grant" }), {
      phase: "login",
      authRealm: "master",
    });
    expect(mapped.kind).toBe("auth");
    expect(mapped.message).toMatch(/Authentication against Keycloak realm 'master' failed/);
  });

  it("maps timeouts", () => {
    const error = new DOMException("The operation timed out", "TimeoutError");
    const mapped = mapKeycloakError(error, { timeoutMs: 1000 });
    expect(mapped.kind).toBe("timeout");
    expect(mapped.message).toContain("1000 ms");
  });

  it("maps network failures without leaking internals", () => {
    const mapped = mapKeycloakError(new TypeError("fetch failed"), { baseUrl: "http://kc" });
    expect(mapped.kind).toBe("network");
    expect(mapped.message).toContain("http://kc");
  });

  it("hides unknown errors and passes ToolErrors through", () => {
    expect(mapKeycloakError(new Error("secret stack detail")).message).not.toContain("secret");
    const tool = new ToolError("guard", "nope");
    expect(mapKeycloakError(tool)).toBe(tool);
  });

  it("does not echo the cause of a network failure", () => {
    const error = new TypeError("fetch failed", {
      cause: new Error("connect ECONNREFUSED 10.1.2.3:8443"),
    });
    const { message } = mapKeycloakError(error, { baseUrl: "http://kc" });
    expect(message).not.toContain("10.1.2.3");
    expect(message).not.toContain("ECONNREFUSED");
  });

  it("truncates string and object details to 300 characters", () => {
    const long = `${"A".repeat(300)}TAIL`;
    expect(mapKeycloakError(http(400, long)).message).not.toContain("TAIL");
    expect(mapKeycloakError(http(400, { errorMessage: long })).message).not.toContain("TAIL");
  });

  it("does not dump unknown response bodies", () => {
    const mapped = mapKeycloakError(http(400, { representation: { secret: "LEAK" } }));
    expect(mapped.message).not.toContain("LEAK");
  });

  it("adds no server detail to a 401 from the admin API", () => {
    expect(mapKeycloakError(http(401, { error: "LEAK401" })).message).not.toContain("LEAK401");
  });
});
