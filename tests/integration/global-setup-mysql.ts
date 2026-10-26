import type { TestProject } from "vitest/node";
import { setupKeycloak } from "./global-setup.js";

/** Keycloak backed by MySQL 8.4, for the tests that depend on the database collation. */
export default function setup(project: TestProject) {
  return setupKeycloak(project, "mysql");
}
