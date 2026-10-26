import { describe, expect, it } from "vitest";
import { protectionStatus, protectionWarnings } from "../../src/startup.js";
import { makeConfig } from "../helpers/fakes.js";

describe("protectionStatus", () => {
  it("shows every protection setting", () => {
    expect(protectionStatus(makeConfig())).toEqual({
      readOnly: false,
      toolsets: ["core", "groups", "roles"],
      allowedRealms: "all",
      requireConfirmation: true,
      allowMasterWrite: false,
    });
    expect(
      protectionStatus(
        makeConfig({
          readOnly: true,
          allowedRealms: ["shop", "hr"],
          requireConfirmation: false,
          allowMasterWrite: true,
          toolsets: new Set(["events"]),
        }),
      ),
    ).toEqual({
      readOnly: true,
      toolsets: ["events"],
      allowedRealms: ["shop", "hr"],
      requireConfirmation: false,
      allowMasterWrite: true,
    });
  });
});

describe("protectionWarnings", () => {
  it("warns when write tools are enabled without a realm allowlist", () => {
    const [warning, ...rest] = protectionWarnings(makeConfig());
    expect(rest).toEqual([]);
    expect(warning).toMatch(/^\d+ write tools are enabled and KEYCLOAK_MCP_REALMS is not set/);
    expect(warning).toMatch(/KEYCLOAK_MCP_READ_ONLY=true/);
  });

  it.each([
    ["read-only mode", { readOnly: true }],
    ["an allowlist", { allowedRealms: ["shop"] }],
    ["only read-only toolsets", { toolsets: new Set(["clients", "events"] as const) }],
  ])("is quiet with %s", (_label, overrides) => {
    expect(protectionWarnings(makeConfig(overrides))).toEqual([]);
  });
});
