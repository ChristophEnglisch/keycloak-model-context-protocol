# Upgrading to 1.0

A complete rewrite of the server. Everything from the 0.0.x line that mattered is still there, but names, configuration and output format changed. Read [Migration from 0.0.x](#migration) before upgrading.

## Highlights

- **24 tools in 7 toolsets**: `core` (realms, users), `groups`, `roles`, `clients`, `sessions`, `events`, `security`. Default toolsets are `core,groups,roles`; enable others with `KEYCLOAK_MCP_TOOLSETS` (or `all`). See the [tools reference](tools-reference.md).
- **4 prompts** for common workflows: `onboard_employee`, `offboard_employee`, `audit_realm_security`, `investigate_failed_logins`.
- **Resources**: `keycloak://realms`, `keycloak://realms/{realm}`, `keycloak://realms/{realm}/security-summary`, `keycloak://realms/{realm}/users/{userId}`, with completion for `realm`.
- **Safe by default**:
  - `KEYCLOAK_MCP_READ_ONLY` registers read-only tools only.
  - `KEYCLOAK_MCP_REALMS` restricts the realms that can be targeted.
  - Write operations in `master` are blocked unless `KEYCLOAK_MCP_ALLOW_MASTER_WRITE=true`.
  - Destructive tools (`user_delete`, `user_group_remove`, `user_role_revoke`, `user_logout`) show a preview and require `confirm: true`.
  - No default credentials; the server refuses to start with an incomplete configuration.
- **Service-account login** with the `client_credentials` grant (recommended). The password grant stays available.
- **Token cache** with refresh, single-flight login and one retry after HTTP 401. The login realm is fixed (`KEYCLOAK_AUTH_REALM`), the target realm travels in each request.
- **Structured output**: every tool has an `outputSchema` and returns `structuredContent`. Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) are set on all tools.
- **Clean errors**: HTTP 401, 403, 404, 409, timeouts and TLS problems are mapped to actionable `isError` messages without stack traces.
- **Audit log** on stderr: one line per tool call and resource read, with secrets masked.
- **Pagination** (`first`, `max`) on all list tools.
- **SDK v2** (`@modelcontextprotocol/server`), Keycloak admin client 26.8, Zod 4. `npm audit --omit=dev` reports no vulnerabilities.
- **Tooling**: Vitest unit, integration (Testcontainers) and packaging smoke tests, Biome, CI on Node 22, 24 and 26, release-please, npm Trusted Publishing with provenance, MCP Registry metadata (`server.json`).
- **Fixes from 0.0.x** that were planned as a separate 0.0.3 hotfix and are part of 1.0 instead: the missing shebang (the binary did not start under `npx`), the shared realm state that could send credentials to or act in the wrong realm, path manipulation through `realm` and `userId`, login errors surfacing as protocol errors, the hard-coded server version.

## Breaking changes

- **Tool names changed** to `<domain>_<verb>` in snake_case. See the table below.
- **Environment variables**: credentials no longer have defaults (`admin` / `admin` and `http://localhost:8080` are gone). `KEYCLOAK_URL` and credentials are required. `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD` are deprecated aliases.
- **Node.js 22 or newer** is required (`engines.node >= 22`).
- **Output format**: tools return `structuredContent` (typed objects) plus a short summary text, instead of free-form JSON text.
- **`user_delete` requires confirmation** by default: the first call returns a preview, the call must be repeated with `confirm: true`.
- **`user_create`** needs only `realm` and `username`; `email`, `firstName` and `lastName` are optional. `email` must be a valid address.
- **`user_search`** (formerly `list-users`) is paginated: default 50 results, at most 200 per call. Use `first` and `max`.
- Only `core`, `groups` and `roles` are active by default. Clients, sessions, events and security tools must be enabled.
- Write operations in the `master` realm are blocked by default.

<a id="migration"></a>

## Migration from 0.0.x

### Tool names

| 0.0.x         | 1.0           | Notes                                                                                               |
| ------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `create-user` | `user_create` | `realm`, `username` required; `email`, `firstName`, `lastName`, `enabled`, `emailVerified` optional |
| `delete-user` | `user_delete` | Now destructive: preview first, then `confirm: true`. Parameters `realm`, `userId` unchanged        |
| `list-realms` | `realm_list`  | Returns realm names, display name and enabled flag; paginated                                       |
| `list-users`  | `user_search` | Adds `search`, `username`, `email`, `exact`, `first`, `max`                                         |

New tools without a 0.0.x predecessor: `realm_get`, `user_get`, `user_update`, `user_send_actions_email`, `group_list`, `group_members_list`, `user_group_add`, `user_group_remove`, `role_list`, `user_roles_list`, `user_role_assign`, `user_role_revoke`, `client_list`, `client_get`, `user_sessions_list`, `user_logout`, `event_list`, `admin_event_list`, `user_brute_force_status`, `user_brute_force_unlock`.

If you saved prompts, rules or scripts that mention the old tool names, update them.

### Environment variables

| 0.0.x                                            | 1.0                                                                                                                                                                                                   | Notes                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `KEYCLOAK_URL` (default `http://localhost:8080`) | `KEYCLOAK_URL`                                                                                                                                                                                        | **Required**, no default                                                                     |
| `KEYCLOAK_ADMIN` (default `admin`)               | `KEYCLOAK_USERNAME`                                                                                                                                                                                   | No default. The old name still works and logs a deprecation warning                          |
| `KEYCLOAK_ADMIN_PASSWORD` (default `admin`)      | `KEYCLOAK_PASSWORD`                                                                                                                                                                                   | No default. The old name still works and logs a deprecation warning                          |
| (logged in to `master` with `admin-cli`)         | `KEYCLOAK_AUTH_REALM` (default `master`), `KEYCLOAK_CLIENT_ID` (default `admin-cli` for the password grant), `KEYCLOAK_GRANT_TYPE`                                                                    | Grant type is detected: `client_credentials` if a client secret is set, otherwise `password` |
| not available                                    | `KEYCLOAK_CLIENT_ID` + `KEYCLOAK_CLIENT_SECRET`                                                                                                                                                       | Recommended: service account with `client_credentials`                                       |
| not available                                    | `KEYCLOAK_MCP_READ_ONLY`, `KEYCLOAK_MCP_REALMS`, `KEYCLOAK_MCP_ALLOW_MASTER_WRITE`, `KEYCLOAK_MCP_TOOLSETS`, `KEYCLOAK_MCP_REQUIRE_CONFIRMATION`, `KEYCLOAK_MCP_TIMEOUT_MS`, `KEYCLOAK_MCP_LOG_LEVEL` | See [configuration](configuration.md)                                                   |

Minimal migration of an existing Claude Desktop entry, keeping the password grant:

```json
{
  "mcpServers": {
    "keycloak": {
      "command": "npx",
      "args": ["-y", "keycloak-model-context-protocol@1.0.0"],
      "env": {
        "KEYCLOAK_URL": "https://keycloak.example.com",
        "KEYCLOAK_USERNAME": "<username>",
        "KEYCLOAK_PASSWORD": "<password>"
      }
    }
  }
}
```

Better: create a service account and switch to `KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET`. See [getting started](getting-started.md).

### Runtime

- Upgrade to **Node.js 22 or newer**. Older versions are end of life and unsupported.
- The binary is still called `keycloak-model-context-protocol` (0.0.1 used `mcp-server-keycloak`).
- The server announces its name as `keycloak-model-context-protocol` (0.0.x: `keycloak-admin`) and its real package version.

### Output format

Tools now return a typed object in `structuredContent`, validated against the tool's `outputSchema`. The text content is only a short summary. List tools return `{ items, first, max, hasMore }`. Code or prompts that parsed the old JSON text must read the structured fields instead.

### Behaviour changes to be aware of

- If you run against `master` as a super admin and rely on writes there, set `KEYCLOAK_MCP_ALLOW_MASTER_WRITE=true`, or better use a dedicated service account in a non-`master` realm.
- Roles and rights: with a service account, assign only the `realm-management` roles you need. Missing roles produce a `403` message that names the problem. See [troubleshooting](troubleshooting.md).
- Lists are limited to a page. Increase `max` (up to 200) or page with `first`.
