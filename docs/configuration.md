# Configuration

The server is configured only through **environment variables**. They are read once at startup; an invalid or contradictory configuration makes the process exit immediately with a list of all problems on stderr (nothing is silently defaulted for credentials). A template is in [`.env.example`](../.env.example).

## Contents

- [Quick reference](#quick-reference)
- [Variable reference](#variable-reference)
- [Authentication](#authentication)
- [Toolsets](#toolsets)
- [Safety controls](#safety-controls)
- [Timeouts and logging](#timeouts-and-logging)
- [Minimal roles per tool](#minimal-roles-per-tool)
- [Recommended role profiles](#recommended-role-profiles)
- [Managing more than one realm](#managing-more-than-one-realm)
- [TLS and custom certificate authorities](#tls-and-custom-certificate-authorities)

## Quick reference

Minimal (service account, recommended):

```bash
KEYCLOAK_URL=https://keycloak.example.com
KEYCLOAK_AUTH_REALM=demo
KEYCLOAK_CLIENT_ID=mcp-admin
KEYCLOAK_CLIENT_SECRET=<client-secret>
```

Locked down (read-only, one realm, more toolsets):

```bash
KEYCLOAK_MCP_READ_ONLY=true
KEYCLOAK_MCP_REALMS=demo
KEYCLOAK_MCP_TOOLSETS=core,groups,roles,sessions,security
```

## Variable reference

Boolean values accept `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off` (case-insensitive). An empty or whitespace-only value counts as **not set**.

| Variable | Required | Default | Secret | Description | Example |
| --- | :---: | --- | :---: | --- | --- |
| `KEYCLOAK_URL` | yes | none | no | Base URL of the Keycloak server (`http` or `https`). Trailing slashes are removed. Include the path prefix if Keycloak is served under one. | `https://keycloak.example.com` |
| `KEYCLOAK_AUTH_REALM` | no | `master` | no | Realm in which the login client or user lives. This is **not** the realm you administer; tools take the target realm as an argument. | `demo` |
| `KEYCLOAK_GRANT_TYPE` | no | auto-detected | no | `client_credentials` or `password`. See [Grant auto-detection](#grant-auto-detection). | `client_credentials` |
| `KEYCLOAK_CLIENT_ID` | yes for `client_credentials`; no for `password` | `admin-cli` for `password`, none otherwise | no | OAuth2 client used for login. | `mcp-admin` |
| `KEYCLOAK_CLIENT_SECRET` | yes for `client_credentials`; optional for `password` | none | **yes** | Secret of a confidential client. | `<client-secret>` |
| `KEYCLOAK_USERNAME` | yes for `password` | none | no | User for the password grant. | `mcp-service-user` |
| `KEYCLOAK_PASSWORD` | yes for `password` | none | **yes** | Password of that user. | `<password>` |
| `KEYCLOAK_ADMIN` | no | none | no | **Deprecated** alias of `KEYCLOAK_USERNAME`. | |
| `KEYCLOAK_ADMIN_PASSWORD` | no | none | **yes** | **Deprecated** alias of `KEYCLOAK_PASSWORD`. | |
| `KEYCLOAK_MCP_TOOLSETS` | no | `core,groups,roles` | no | Comma-separated toolsets to enable, or `all`. | `core,groups,roles,events` |
| `KEYCLOAK_MCP_READ_ONLY` | no | `false` | no | Register only tools of kind *read*. Write and destructive tools do not exist for the client. | `true` |
| `KEYCLOAK_MCP_REALMS` | no | empty (all realms) | no | Comma-separated allowlist of target realms. Applies to tools, resources, prompts and completions. | `demo,staging` |
| `KEYCLOAK_MCP_ALLOW_MASTER_WRITE` | no | `false` | no | Allow write and destructive tools in the `master` realm. | `false` |
| `KEYCLOAK_MCP_REQUIRE_CONFIRMATION` | no | `true` | no | Destructive and sensitive tools require `confirm: true`. `false` turns this off, except for grants of administrative rights, profile changes and action e-mails for accounts with administrative rights, and changes to the server's own account. | `true` |
| `KEYCLOAK_MCP_TIMEOUT_MS` | no | `30000` | no | HTTP timeout for requests to Keycloak, in milliseconds (integer, at least 1). | `15000` |
| `KEYCLOAK_MCP_LOG_LEVEL` | no | `info` | no | `debug`, `info`, `warn` or `error`. Logs go to stderr. | `warn` |

`NODE_EXTRA_CA_CERTS` is a Node.js variable, not a server setting. See [TLS](#tls-and-custom-certificate-authorities).

## Authentication

### client_credentials (recommended)

Create a confidential client with a service account and give that account only the roles you need ([getting-started](getting-started.md#2-create-a-service-account-client)).

```bash
KEYCLOAK_CLIENT_ID=mcp-admin
KEYCLOAK_CLIENT_SECRET=<client-secret>
KEYCLOAK_AUTH_REALM=demo
```

There is no user password involved, the account cannot log in interactively, and the secret can be rotated independently. Because no interactive login is involved, OTP and required actions are not an issue.

### password

Signs in as a user through a direct access grant. The client defaults to `admin-cli`.

```bash
KEYCLOAK_USERNAME=mcp-service-user
KEYCLOAK_PASSWORD=<password>
KEYCLOAK_AUTH_REALM=master          # realm of the user
# KEYCLOAK_CLIENT_ID=admin-cli      # default
```

Requirements: the client must allow *Direct access grants* (true for `admin-cli`), and the account must not require OTP or other required actions, otherwise login fails with `invalid_grant`.

### Grant auto-detection

If `KEYCLOAK_GRANT_TYPE` is not set, the grant is derived from what you provide:

1. `KEYCLOAK_CLIENT_SECRET` is set: `client_credentials`.
2. Otherwise, a username (`KEYCLOAK_USERNAME`, or the deprecated `KEYCLOAK_ADMIN`) is set: `password`.
3. Otherwise: startup fails with "No credentials configured".

If you set both a client secret and a username, the secret wins; set `KEYCLOAK_GRANT_TYPE=password` explicitly to use the user instead (the secret is then sent as the client secret, for confidential clients). Missing parts for the chosen grant (for example no `KEYCLOAK_CLIENT_ID` with `client_credentials`) are reported as configuration errors.

Tokens are cached and refreshed shortly before they expire. On an HTTP 401 from Keycloak the server logs in again once and retries the call. Login happens on the first tool call, so the server starts even if Keycloak is not reachable yet.

### Legacy aliases and deprecation

| 0.x variable | Use now | Behaviour in 1.0 |
| --- | --- | --- |
| `KEYCLOAK_ADMIN` | `KEYCLOAK_USERNAME` | Still read when `KEYCLOAK_USERNAME` is unset; logs a deprecation warning on stderr |
| `KEYCLOAK_ADMIN_PASSWORD` | `KEYCLOAK_PASSWORD` | Still read when `KEYCLOAK_PASSWORD` is unset; logs a deprecation warning |

If both the new and the legacy variable are set, the new one wins and no warning is logged. The aliases only cover the variable names. **The 0.x fallback defaults are gone:** `KEYCLOAK_URL` is now required (it used to default to `http://localhost:8080`), and there is no default user or password (`admin`/`admin`). See the [migration notes](migration-1.0.md).

## Toolsets

Tools are grouped into seven toolsets. Set `KEYCLOAK_MCP_TOOLSETS` to a comma-separated list, or to `all`. Names are lowercase; an unknown name is a startup error. If the variable is empty, the default applies.

| Toolset | Default | Tools | Purpose |
| --- | :---: | :---: | --- |
| `core` | yes | 8 | Realms and user lifecycle |
| `groups` | yes | 4 | Group listing and membership |
| `roles` | yes | 4 | Role listing and user role mappings |
| `clients` | no | 2 | Read-only client inspection |
| `sessions` | no | 2 | User sessions and forced logout |
| `events` | no | 2 | Login and admin audit events |
| `security` | no | 2 | Brute-force status and unlock |

The full tool list per toolset is in the [README](../README.md#toolsets-and-tools) and in [tools-reference.md](tools-reference.md). Enable only what you need: a tool that is not registered cannot be called, and a smaller tool list also uses less of the model's context.

Prompts that need tools from a non-default toolset (`audit_realm_security`, `investigate_failed_logins`) tell the assistant to ask you to enable the toolset instead of improvising.

## Safety controls

| Control | Effect |
| --- | --- |
| **Read-only** (`KEYCLOAK_MCP_READ_ONLY=true`) | Only tools of kind *read* are registered; the 10 write and destructive tools never appear in `tools/list`. This is the strongest control and independent of Keycloak roles. |
| **Realm allowlist** (`KEYCLOAK_MCP_REALMS`) | Calls for a realm outside the list are rejected before any request is sent. `realm_list`, the `keycloak://realms` resource and prompt completion only show allowed realms. Empty means every realm. |
| **`master` write protection** (`KEYCLOAK_MCP_ALLOW_MASTER_WRITE=false`) | Write and destructive tools reject the realm `master` (case-insensitive). Reads still work. Set to `true` only if you really administer `master` through the assistant. |
| **Confirmation** (`KEYCLOAK_MCP_REQUIRE_CONFIRMATION=true`) | Destructive tools (`user_delete`, `user_group_remove`, `user_role_revoke`, `user_logout`) and sensitive tools (`user_create`, `user_update`, `user_send_actions_email`, `user_group_add`, `user_role_assign`, `user_brute_force_unlock`) first return a preview and change nothing; the assistant must repeat the call with `confirm: true` after you approved. Grants of administrative rights, also through composite roles and parent groups, `user_update` and `user_send_actions_email` for accounts with administrative rights, and changes to the server's own account always need confirmation; see [security](security.md#sensitive-writes). |
| **Path-segment validation** | Realm names and IDs containing `/`, `\`, `..` or control characters are rejected, so arguments cannot redirect a request to another API path. |

> [!WARNING]
> `KEYCLOAK_MCP_REQUIRE_CONFIRMATION=false` removes the preview step for ordinary changes. Your MCP client may still ask you to approve each tool call, but the server will no longer enforce it. Grants of administrative rights, profile changes and action e-mails for accounts with administrative rights, and changes to the server's own account still need `confirm: true`. Keep the default unless you run unattended automation in a disposable environment.

## Timeouts and logging

- **`KEYCLOAK_MCP_TIMEOUT_MS`** limits every HTTP request to Keycloak (login included). On expiry the tool returns an error that names the timeout instead of hanging. Raise it for slow, remote or heavily loaded Keycloak instances.
- **Logs** are written to **stderr**, because stdout carries the MCP protocol. Format: `<ISO time> <LEVEL> <message> {json fields}`. At `info` you get one line at startup (version, URL, auth realm, grant type, toolsets) and one `tool_call` or `resource_read` line per call with tool name, realm, outcome and duration. **Arguments and results are not logged**, so no user data ends up in logs. Field names containing `secret`, `password`, `token`, `authorization` or `credential` are redacted, and the configured secret values are masked anywhere in a line.
- Use `debug` for troubleshooting (for example login and token-refresh decisions). Where the logs show up depends on the client: Claude Desktop writes them to its MCP log files, the MCP Inspector shows them in its notifications pane.

## Minimal roles per tool

> [!IMPORTANT]
> **Status: verified against Keycloak 24.0, 25.0, 26.0 and 26.8.** The rows below come from [`tests/integration/role-matrix.ts`](../tests/integration/role-matrix.ts). `tests/integration/role-matrix.test.ts` proves each row marked as tested against a real Keycloak: the tool works with exactly these roles, and the "denied with" set yields HTTP 403. It runs in CI for every change. It does not prove that a smaller role set is impossible. Rows marked *assumed* are not covered by the test. If you find a deviation on your Keycloak version, please open an issue.

All roles are **client roles of the `realm-management` client** of the target realm. Assign them to the service account of your client (Clients > `mcp-admin` > Service accounts roles > Assign role > Filter by clients). The role set must be **exactly sufficient**: for example `view-users` alone does not allow searching the client list, and `view-users` does not allow writing.

| Tool | Toolset | Kind | Minimal roles | Notes |
| --- | --- | --- | --- | --- |
| `realm_list` | core | read | `view-realm` | *Assumed.* Lists only realms the account may see; an account without roles gets an empty list, not a 403. |
| `realm_get` | core | read | `view-realm` | |
| `user_search` | core | read | `query-users` | `view-users` also works; `query-users` is the narrower role. |
| `user_get` | core | read | `view-users` | |
| `user_create` | core | sensitive | `manage-users` | |
| `user_update` | core | sensitive | `manage-users` | `manage-users` implies view access to users. Without `view-clients` the preview cannot tell whether the account has administrative rights. |
| `user_delete` | core | destructive | `manage-users` | |
| `user_send_actions_email` | core | sensitive | `manage-users` | *Assumed.* Also needs SMTP configured in the realm. Without `view-clients` the preview cannot tell whether the account has administrative rights. |
| `group_list` | groups | read | `query-groups` | |
| `group_members_list` | groups | read | `view-users` | |
| `user_group_add` | groups | sensitive | `manage-users` | Without `view-clients` Keycloak hides client roles of groups, so every group membership needs a confirmation that cannot be turned off. |
| `user_group_remove` | groups | destructive | `manage-users` | |
| `role_list` | roles | read | `view-realm` | |
| `user_roles_list` | roles | read | `view-users` | |
| `user_role_assign` | roles | sensitive | `manage-users` + `view-realm` | `manage-users` maps the role; `view-realm` lets the tool look the role up by name. Without `view-clients`, composite roles need a confirmation that cannot be turned off. |
| `user_role_revoke` | roles | destructive | `manage-users` + `view-realm` | Same as `user_role_assign`. |
| `client_list` | clients | read | `query-clients` | Without it, Keycloak before 26.8 returns only clients the account holds roles of instead of HTTP 403. |
| `client_get` | clients | read | `view-clients` | Without it, Keycloak before 26.8 reports the client as not found; the error message names the missing role. |
| `user_sessions_list` | sessions | read | `view-users` | |
| `user_logout` | sessions | destructive | `manage-users` | |
| `event_list` | events | read | `view-events` | Realm event storage must be enabled. |
| `admin_event_list` | events | read | `view-events` | Realm admin events must be enabled. |
| `user_brute_force_status` | security | read | `view-users` | |
| `user_brute_force_unlock` | security | sensitive | `manage-users` | |

Keep in mind:

- Keycloak's `realm-admin` composite role contains all of these (and more). Do not use it unless you accept full control of the realm.
- Roles that exist in Keycloak but are not needed by any tool (for example `manage-realm`, `manage-clients`, `manage-authorization`, `impersonation`) should **not** be granted.
- The assistant can only do what both the toolset configuration **and** the roles allow. The recommended setup is to restrict both.

## Recommended role profiles

Each profile pairs Keycloak roles with matching server settings. Roles are `realm-management` client roles.

### Read-only helpdesk

Answer "who is this user, what groups and roles do they have, are they locked out, do they have open sessions".

| Setting | Value |
| --- | --- |
| Roles | `query-users`, `view-users`, `query-groups`, `view-realm` |
| `KEYCLOAK_MCP_TOOLSETS` | `core,groups,roles,sessions,security` |
| `KEYCLOAK_MCP_READ_ONLY` | `true` |
| `KEYCLOAK_MCP_REALMS` | the realm(s) you support |

### User administration

Joiner/mover/leaver work: create and change users, memberships and roles, end sessions, unlock accounts.

| Setting | Value |
| --- | --- |
| Roles | `query-users`, `view-users`, `manage-users`, `query-groups`, `view-realm` |
| `KEYCLOAK_MCP_TOOLSETS` | `core,groups,roles,sessions,security` |
| `KEYCLOAK_MCP_READ_ONLY` | `false` |
| `KEYCLOAK_MCP_REQUIRE_CONFIRMATION` | `true` (default) |
| `KEYCLOAK_MCP_REALMS` | the realm(s) you administer |

`manage-users` already lets the account assign roles, including powerful ones, and change any user of the realm, including administrators. The server resolves composite roles and groups and always asks for confirmation before granting administrative rights or changing the profile or sending action e-mails for an account with administrative rights, and it refuses to extend its own account. Add `view-clients` if the server should rule out administrative rights in composite roles and groups precisely; without it, such grants and target accounts are treated as administrative, so every `user_update` and `user_send_actions_email` needs confirmation. The real protection is still not giving the service account roles you would not want it to hand out.

### Auditor

Security reviews and incident investigation, without any change capability.

| Setting | Value |
| --- | --- |
| Roles | `query-users`, `view-users`, `query-groups`, `view-realm`, `query-clients`, `view-clients`, `view-events` |
| `KEYCLOAK_MCP_TOOLSETS` | `all` |
| `KEYCLOAK_MCP_READ_ONLY` | `true` |
| `KEYCLOAK_MCP_REALMS` | the realm(s) to audit |

This profile runs the `audit_realm_security` and `investigate_failed_logins` prompts completely. Remember to enable login events and admin events in the realm settings (Realm settings > Events), otherwise the event tools return nothing.

## Managing more than one realm

A service account of realm `demo` administers `demo` only. To work on several realms with one server:

1. Create the client in the **`master`** realm (`KEYCLOAK_AUTH_REALM=master`).
2. Assign it the roles from the `<realm>-realm` clients of master, for example the roles of the client `demo-realm` and `staging-realm`. These mirror the `realm-management` roles of each realm, so the [matrix above](#minimal-roles-per-tool) applies unchanged. (The `admin` realm role would grant everything everywhere and is not recommended.)
3. Restrict the reach with `KEYCLOAK_MCP_REALMS=demo,staging`.

Write operations in `master` itself stay blocked unless `KEYCLOAK_MCP_ALLOW_MASTER_WRITE=true`.

## TLS and custom certificate authorities

The server speaks to Keycloak with Node.js's built-in TLS, so it trusts Node's bundled CAs. For a Keycloak behind an internal or private CA, point Node at your CA bundle (PEM) with `NODE_EXTRA_CA_CERTS`:

```bash
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/company-root-ca.pem
```

Set it in the client's `env` block next to the `KEYCLOAK_*` variables, for example:

```json
{
  "mcpServers": {
    "keycloak": {
      "command": "npx",
      "args": ["-y", "keycloak-model-context-protocol@1"],
      "env": {
        "KEYCLOAK_URL": "https://keycloak.internal.example",
        "KEYCLOAK_AUTH_REALM": "demo",
        "KEYCLOAK_CLIENT_ID": "mcp-admin",
        "KEYCLOAK_CLIENT_SECRET": "<client-secret>",
        "NODE_EXTRA_CA_CERTS": "/etc/ssl/certs/company-root-ca.pem"
      }
    }
  }
}
```

The path is read when the Node process starts, so it must be set in the environment of the server process, not later. Do **not** set `NODE_TLS_REJECT_UNAUTHORIZED=0`; it disables certificate verification and exposes your admin token to anyone on the network path. Typical errors (`self-signed certificate`, `unable to verify the first certificate`) are listed in [troubleshooting.md](troubleshooting.md). Use `https` for any Keycloak that is not on `localhost`, otherwise the token and client secret travel in clear text.
