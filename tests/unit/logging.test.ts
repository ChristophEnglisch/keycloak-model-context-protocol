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

  it.each(["accessToken", "Authorization", "credentials", "Password", "refresh_token"])(
    "redacts the value of key %s",
    (key) => {
      const lines: string[] = [];
      const logger = createLogger({ level: "debug", write: (l) => lines.push(l) });
      logger.info("x", { [key]: "VALUE-1" });
      expect(lines[0]).not.toContain("VALUE-1");
      expect(lines[0]).toContain("[REDACTED]");
    },
  );

  it("masks every occurrence of a secret, also in warnings", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "debug",
      secrets: ["s3cr3t"],
      write: (l) => lines.push(l),
    });
    logger.warn("s3cr3t and again s3cr3t", { note: "s3cr3t" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("s3cr3t");
  });
});
