import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GenericContainer,
  getContainerRuntimeClient,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import type { TestProject } from "vitest/node";

/** Connection details of the Keycloak instance the integration tests run against. */
export interface KeycloakInfo {
  url: string;
  version: string;
  /** Database behind Keycloak: the dev default (H2), MySQL, or unknown for IT_KEYCLOAK_URL. */
  db: KeycloakDb | "external";
  adminUser: string;
  adminPassword: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    /** null when the suite is skipped (no Docker); see itSkipReason. */
    itKeycloak: KeycloakInfo | null;
    itSkipReason: string;
  }
}

export type KeycloakDb = "dev" | "mysql";

const ADMIN_USER = "admin";
const ADMIN_PASSWORD = "admin-it-password";
// Keycloak requires import files to be named <realm>-realm.json.
const FIXTURES = ["it-realm-realm.json", "it-realm-b-realm.json"];
const IMPORT_DIR = "/opt/keycloak/data/import";
const root = fileURLToPath(new URL("../..", import.meta.url));

async function dockerIsAvailable(): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      getContainerRuntimeClient(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out after 20 s")), 20_000);
      }),
    ]);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }
}

export default function setup(project: TestProject) {
  return setupKeycloak(project, "dev");
}

export async function setupKeycloak(
  project: TestProject,
  db: KeycloakDb,
): Promise<(() => Promise<void>) | undefined> {
  const external = process.env.IT_KEYCLOAK_URL;
  if (external) {
    // Use an already running Keycloak (e.g. `docker compose up`, see docker-compose.yml).
    project.provide("itKeycloak", {
      url: external.replace(/\/+$/, ""),
      version: "external",
      db: "external",
      adminUser: process.env.IT_KEYCLOAK_ADMIN_USER ?? "admin",
      adminPassword: process.env.IT_KEYCLOAK_ADMIN_PASSWORD ?? "admin",
    });
    project.provide("itSkipReason", "");
    buildOnce();
    return undefined;
  }

  const dockerProblem = await dockerIsAvailable();
  if (dockerProblem !== undefined) {
    const reason = `Docker is not available (${dockerProblem}). Integration tests are SKIPPED. Start Docker, or set IT_KEYCLOAK_URL to use a running Keycloak.`;
    if (process.env.CI === "true") {
      // Printed separately: vitest can garble the stack of errors thrown from globalSetup.
      console.error(`\n[integration] ${reason} Failing hard because CI=true.\n`);
      throw new Error(`${reason} Failing hard because CI=true.`);
    }
    console.warn(`\n[integration] ${reason}\n`);
    project.provide("itKeycloak", null);
    project.provide("itSkipReason", reason);
    return undefined;
  }

  buildOnce();
  const version = process.env.KEYCLOAK_VERSION?.trim() || "26.8";
  const image = `quay.io/keycloak/keycloak:${version}`;
  console.warn(`[integration] Starting ${image} ...`);

  const started: { stop(): Promise<unknown> }[] = [];
  const stopAll = async () => {
    for (const item of started.reverse()) await item.stop();
  };
  let container: StartedTestContainer;
  try {
    let database: Record<string, string> = {};
    let network: StartedNetwork | undefined;
    if (db === "mysql") {
      network = await new Network().start();
      started.push(network);
      console.warn(`[integration] Starting ${MYSQL_IMAGE} ...`);
      started.push(await startMysql(network));
      database = MYSQL_KEYCLOAK_ENV;
    }
    container = await startKeycloak(image, database, network);
    started.push(container);
  } catch (error) {
    // vitest garbles errors thrown from globalSetup, so print the real cause first.
    console.error(`\n[integration] Failed to start ${image} (${db}):`, error);
    await stopAll().catch(() => undefined);
    throw error;
  }

  const url = `http://${container.getHost()}:${container.getMappedPort(8080)}`;
  console.warn(`[integration] Keycloak ${version} (${db}) ready at ${url}`);
  project.provide("itKeycloak", {
    url,
    version,
    db,
    adminUser: ADMIN_USER,
    adminPassword: ADMIN_PASSWORD,
  });
  project.provide("itSkipReason", "");

  return stopAll;
}

// MySQL 8 with its default collation (utf8mb4_0900_ai_ci): case- and accent-insensitive.
const MYSQL_IMAGE = "mysql:8.4";
const MYSQL_KEYCLOAK_ENV = {
  KC_DB: "mysql",
  KC_DB_URL_HOST: "mysql",
  KC_DB_URL_DATABASE: "keycloak",
  KC_DB_USERNAME: "keycloak",
  KC_DB_PASSWORD: "keycloak-it-password",
};

function startMysql(network: StartedNetwork) {
  return (
    new GenericContainer(MYSQL_IMAGE)
      .withNetwork(network)
      .withNetworkAliases("mysql")
      .withEnvironment({
        MYSQL_ROOT_PASSWORD: "root-it-password",
        MYSQL_DATABASE: MYSQL_KEYCLOAK_ENV.KC_DB_URL_DATABASE,
        MYSQL_USER: MYSQL_KEYCLOAK_ENV.KC_DB_USERNAME,
        MYSQL_PASSWORD: MYSQL_KEYCLOAK_ENV.KC_DB_PASSWORD,
      })
      // TCP only answers once the entrypoint's temporary server is gone.
      .withHealthCheck({
        test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "--silent"],
        interval: 2_000,
        timeout: 5_000,
        retries: 60,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(180_000)
      .start()
  );
}

function startKeycloak(image: string, database: Record<string, string>, network?: StartedNetwork) {
  const container = new GenericContainer(image);
  if (network !== undefined) container.withNetwork(network);
  return (
    container
      .withExposedPorts(8080)
      .withEnvironment({
        // Keycloak >= 26.1 reads KC_BOOTSTRAP_ADMIN_*, 24/25 read KEYCLOAK_ADMIN*.
        KC_BOOTSTRAP_ADMIN_USERNAME: ADMIN_USER,
        KC_BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
        KEYCLOAK_ADMIN: ADMIN_USER,
        KEYCLOAK_ADMIN_PASSWORD: ADMIN_PASSWORD,
        ...database,
      })
      .withCopyContentToContainer(
        FIXTURES.map((file) => ({
          content: readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"),
          target: `${IMPORT_DIR}/${file}`,
          mode: 0o644,
        })),
      )
      .withCommand(["start-dev", "--import-realm"])
      // Imported realms are served once the import is done, so this also proves the import worked.
      .withWaitStrategy(Wait.forHttp("/realms/it-realm", 8080).forStatusCode(200))
      .withStartupTimeout(240_000)
      .start()
  );
}

/** The stdio test starts dist/index.js, so make sure the build is current. */
function buildOnce(): void {
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"], {
    cwd: root,
    stdio: "inherit",
  });
}
