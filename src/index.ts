#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ConfigError, collectSecrets, loadConfig } from "./config.js";
import { KeycloakAdminGateway } from "./keycloak/gateway.js";
import { createLogger } from "./logging.js";
import { createServer } from "./server.js";
import { protectionStatus, protectionWarnings } from "./startup.js";
import { VERSION } from "./version.js";

function main(): void {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(
      `${error instanceof ConfigError ? error.message : "Failed to load configuration."}\n`,
    );
    process.exit(1);
  }

  const logger = createLogger({ level: config.logLevel, secrets: collectSecrets(config) });
  for (const warning of [...config.warnings, ...protectionWarnings(config)]) logger.warn(warning);

  // Login happens lazily on the first tool call, so startup needs no reachable Keycloak.
  const gateway = new KeycloakAdminGateway(config, { logger });
  const handle = serveStdio(() => createServer({ config, gateway, logger }), {
    onerror: (error) => logger.error("Transport error", { error: error.message }),
  });
  logger.info("keycloak-model-context-protocol started", {
    version: VERSION,
    url: config.url,
    authRealm: config.authRealm,
    grantType: config.credentials.grantType,
    ...protectionStatus(config),
  });

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    // The logout has its own short timeout; this only guards against a hanging close.
    setTimeout(() => process.exit(0), 5_000).unref();
    Promise.allSettled([handle.close(), gateway.close()]).finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // The client closing stdin is the normal way an MCP stdio session ends.
  process.stdin.on("end", shutdown);
}

main();
