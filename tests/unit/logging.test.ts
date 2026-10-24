import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/logging.js";

describe("createLogger", () => {
  it("respects the level and masks secrets", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      secrets: ["hunter2"],
      write: (l) => lines.push(l),
    });
    logger.debug("hidden");
    logger.info("login with hunter2", { password: "x", user: "bob" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("hunter2");
    expect(lines[0]).toContain("[REDACTED]");
    expect(lines[0]).toContain("bob");
  });
});
