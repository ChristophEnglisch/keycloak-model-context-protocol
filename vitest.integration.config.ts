import { defineConfig } from "vitest/config";

// Integration tests run against a real Keycloak.
// tests/integration/global-setup.ts starts ONE container per run (testcontainers) and shares it
// with all test files; without Docker (and outside CI) the suites are skipped with a message.
// Set IT_KEYCLOAK_URL to use an already running Keycloak (docker-compose.yml) instead.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    passWithNoTests: true,
    fileParallelism: false,
  },
});
