import { defineConfig } from "vitest/config";

// The realm and role name tests once more against Keycloak on MySQL 8.4, whose default
// collation is case- and accent-insensitive. Kept small: one extra container pair.
export default defineConfig({
  test: {
    include: ["tests/integration/name-resolution.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup-mysql.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
