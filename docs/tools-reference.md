<!--
  GENERATED FILE - DO NOT EDIT.
  Source: tools/list, prompts/list and resources/templates/list of the built server.
  Regenerate with `npm run docs:tools`; `npm run docs:check` fails when this file is stale.
-->

# Tools reference

> Generated from the server definitions. Do not edit by hand.

The server exposes 24 tools in 7 toolsets, 4 prompts and 4 resources. Which tools are registered depends on `KEYCLOAK_MCP_TOOLSETS` (default: `core,groups,roles`) and `KEYCLOAK_MCP_READ_ONLY` (hides every tool that is not read-only). See [configuration](configuration.md).

Conventions:

- Every tool takes the target `realm` explicitly. It is the realm to operate on, not the realm used for login.
- Every tool that changes data is *sensitive* (it changes identity, credentials, rights or protection mechanisms) or *destructive* (it deletes or revokes). Both kinds carry `destructiveHint=true` and take an additional optional `confirm` parameter. A call without `confirm: true` only returns a preview and changes nothing; call again with `confirm: true` after the user approved. The model can set `confirm: true` itself, even on the first call: the server then still computes the preview and returns it with the result, but only the client's approval prompt proves that a human agreed.
- `KEYCLOAK_MCP_REQUIRE_CONFIRMATION=false` turns the confirmation off, except for grants of administrative rights (also through composite roles and groups) and changes to the account the server signs in with. For that account, role and group grants, `user_update` and `user_send_actions_email` are refused.
- List tools are paginated with `first` and `max` and return `{ items, first, max, hasMore }`.
- Results carry a short neutral summary in `content` and the data in `structuredContent`. Errors are returned with `isError: true`.

## Overview

| Toolset | Tool | Kind | Description |
|---|---|---|---|
| `core` | [`realm_list`](#list-realms) | read | List the Keycloak realms visible to the configured admin account (restricted to KEYCLOAK_MCP_REALMS if set). |
| `core` | [`realm_get`](#get-realm-settings) | read | Get a safe subset of a realm's settings (login, session, brute-force, password policy and event flags). |
| `core` | [`user_search`](#search-users) | read | Search users in a realm by free text and/or exact fields, with pagination. |
| `core` | [`user_get`](#get-user) | read | Get one user by ID with a safe subset of fields (no attributes, no credentials). |
| `core` | [`user_create`](#create-user) | sensitive | Create a new user in a realm. |
| `core` | [`user_update`](#update-user) | sensitive | Update selected fields of a user (partial update; only the given fields are sent, everything else stays unchanged). |
| `core` | [`user_delete`](#delete-user) | destructive | Permanently delete a user from a realm. |
| `core` | [`user_send_actions_email`](#send-required-actions-e-mail) | sensitive | Send the user an e-mail with a link to perform required actions (e.g. update password, verify e-mail). |
| `groups` | [`group_list`](#list-groups) | read | List groups of a realm, optionally filtered by a search string, with pagination. |
| `groups` | [`group_members_list`](#list-group-members) | read | List the members of a group with a safe subset of user fields, with pagination. |
| `groups` | [`user_group_add`](#add-user-to-group) | sensitive | Add a user to a group. |
| `groups` | [`user_group_remove`](#remove-user-from-group) | destructive | Remove a user from a group. |
| `roles` | [`role_list`](#list-roles) | read | List realm roles, or the roles of one client when `clientId` is given, optionally filtered by a search string, with pagination. |
| `roles` | [`user_roles_list`](#list-user-role-mappings) | read | List the realm and client roles assigned to a user. |
| `roles` | [`user_role_assign`](#assign-roles-to-user) | sensitive | Assign realm roles (or roles of one client when `clientId` is given) to a user. |
| `roles` | [`user_role_revoke`](#revoke-roles-from-user) | destructive | Remove realm roles (or roles of one client when `clientId` is given) from a user. |
| `clients` | [`client_list`](#list-clients) | read | List clients of a realm with pagination, optionally filtered by clientId (prefix/infix search). |
| `clients` | [`client_get`](#get-client) | read | Get one client by internal `id` or by `clientId` (exactly one of them). |
| `sessions` | [`user_sessions_list`](#list-user-sessions) | read | List the active sessions of a user (IP address, start, last access, clients). |
| `sessions` | [`user_logout`](#log-out-user) | destructive | End all active sessions of a user (forced logout). |
| `events` | [`event_list`](#list-login-events) | read | List user/login events of a realm (logins, failed logins, logouts, password changes) with filters and pagination. |
| `events` | [`admin_event_list`](#list-admin-events) | read | List admin (audit) events of a realm: who changed which resource and when. |
| `security` | [`user_brute_force_status`](#get-brute-force-status) | read | Show the brute-force detection state of a user: whether the account is temporarily locked and recent failure counters. |
| `security` | [`user_brute_force_unlock`](#unlock-user-brute-force) | sensitive | Clear the brute-force detection state of a user so a temporarily locked account can log in again. |

## Toolset `core`

#### List realms

`realm_list`

**read-only · idempotent**

List the Keycloak realms visible to the configured admin account (restricted to KEYCLOAK_MCP_REALMS if set). Returns names only, not realm settings.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `first` | `integer (min 0)` | no | `0` | Index of the first result to return (offset, default 0). |
| `max` | `integer (min 1, max 200)` | no | `50` | Maximum number of results (default 50, at most 200). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `items` | `object[]` |   |
| `items[].realm` | `string` | Realm name (use this as the `realm` argument of other tools). |
| `items[].displayName` | `string` | Human-readable realm name. |
| `items[].enabled` | `boolean` | Whether the realm is enabled. |
| `first` | `integer` | Offset used for this page. |
| `max` | `integer` | Page size used for this page. |
| `hasMore` | `boolean` | True if more results exist beyond this page. |

#### Get realm settings

`realm_get`

**read-only · idempotent**

Get a safe subset of a realm's settings (login, session, brute-force, password policy and event flags). SMTP credentials, keys and other secrets are never returned.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `realm` | `string` | Realm name. |
| `displayName` | `string` | Human-readable realm name. |
| `enabled` | `boolean` | Whether the realm is enabled. |
| `sslRequired` | `string` | SSL requirement: all, external or none. |
| `registrationAllowed` | `boolean` | Whether self-registration is allowed. |
| `loginWithEmailAllowed` | `boolean` | Whether users may log in with e-mail. |
| `duplicateEmailsAllowed` | `boolean` | Whether duplicate e-mails are allowed. |
| `resetPasswordAllowed` | `boolean` | Whether 'forgot password' is enabled. |
| `verifyEmail` | `boolean` | Whether e-mail verification is required. |
| `bruteForceProtected` | `boolean` | Whether brute-force detection is on. |
| `passwordPolicy` | `string` | Password policy expression. |
| `otpPolicyType` | `string` | OTP type: totp or hotp. |
| `accessTokenLifespan` | `number` | Access token lifespan in seconds. |
| `ssoSessionIdleTimeout` | `number` | SSO session idle timeout in seconds. |
| `ssoSessionMaxLifespan` | `number` | SSO session max lifespan in seconds. |
| `eventsEnabled` | `boolean` | Whether login events are stored. |
| `adminEventsEnabled` | `boolean` | Whether admin events are stored. |

#### Search users

`user_search`

**read-only · idempotent**

Search users in a realm by free text and/or exact fields, with pagination. Without filters it lists all users. Use `search` for a general match on username, name and e-mail (prefix/infix); set `exact` to match username/email exactly.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `search` | `string` | no |   | Free-text search across username, name and e-mail. |
| `username` | `string` | no |   | Filter by username. |
| `email` | `string` | no |   | Filter by e-mail address. |
| `exact` | `boolean` | no |   | If true, `username`/`email`/`search` must match exactly instead of by prefix. |
| `first` | `integer (min 0)` | no | `0` | Index of the first result to return (offset, default 0). |
| `max` | `integer (min 1, max 200)` | no | `50` | Maximum number of results (default 50, at most 200). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `items` | `object[]` |   |
| `items[].id` | `string` | User ID (UUID); use it as `userId` in other tools. |
| `items[].username` | `string` | Login name. |
| `items[].email` | `string` | E-mail address, if set. |
| `items[].firstName` | `string` | First name, if set. |
| `items[].lastName` | `string` | Last name, if set. |
| `items[].enabled` | `boolean` | Whether the user can log in. |
| `items[].emailVerified` | `boolean` | Whether the e-mail address is verified. |
| `first` | `integer` | Offset used for this page. |
| `max` | `integer` | Page size used for this page. |
| `hasMore` | `boolean` | True if more results exist beyond this page. |
| `realm` | `string` | Realm that was searched. |

#### Get user

`user_get`

**read-only · idempotent**

Get one user by ID with a safe subset of fields (no attributes, no credentials). Use user_search to find the ID.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user, e.g. from user_search. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `id` | `string` | User ID (UUID); use it as `userId` in other tools. |
| `username` | `string` | Login name. |
| `email` | `string` | E-mail address, if set. |
| `firstName` | `string` | First name, if set. |
| `lastName` | `string` | Last name, if set. |
| `enabled` | `boolean` | Whether the user can log in. |
| `emailVerified` | `boolean` | Whether the e-mail address is verified. |
| `createdTimestamp` | `number` | Creation time in epoch milliseconds. |
| `requiredActions` | `string[]` | Pending required actions. |
| `totp` | `boolean` | Whether the user has OTP configured. |
| `federationLink` | `string` | ID of the federation provider, if any. |

#### Create user

`user_create`

**sensitive · not idempotent · requires `confirm: true`**

Create a new user in a realm. The user is enabled by default and has no credentials; use a separate flow to set a password or send required actions. Requires confirm: true after the user approved the preview.

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=false`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `username` | `string` | yes |   | Unique login name. |
| `email` | `string (email)` | no |   | E-mail address. |
| `firstName` | `string` | no |   | First name. |
| `lastName` | `string` | no |   | Last name. |
| `enabled` | `boolean` | no | `true` | Whether the user can log in (default true). |
| `emailVerified` | `boolean` | no |   | Mark the e-mail address as verified. |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `id` | `string` | ID of the created user. |
| `username` | `string` | Username of the created user. |
| `realm` | `string` | Realm the user was created in. |

#### Update user

`user_update`

**sensitive · idempotent · requires `confirm: true`**

Update selected fields of a user (partial update; only the given fields are sent, everything else stays unchanged). At least one field besides realm and userId is required. Setting `requiredActions` replaces the existing list. Changing `email` marks the address as unverified unless `emailVerified` is given. Requires confirm: true after the user approved the preview, which names the old and new values and whether the account has administrative rights. The account this server signs in with cannot be changed.

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user to update. |
| `email` | `string (email)` | no |   | New e-mail address. Marks the address as unverified unless emailVerified is set. |
| `firstName` | `string` | no |   | New first name. |
| `lastName` | `string` | no |   | New last name. |
| `enabled` | `boolean` | no |   | Enable or disable the user. |
| `emailVerified` | `boolean` | no |   | Mark the e-mail as verified or not. |
| `requiredActions` | `string[]` | no |   | Required actions to set, e.g. UPDATE_PASSWORD (replaces the existing list). |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `userId` | `string` | ID of the updated user. |
| `realm` | `string` | Realm of the user. |
| `updatedFields` | `string[]` | Names of the fields that were set, including emailVerified when it was reset. |

#### Delete user

`user_delete`

**destructive · idempotent · requires `confirm: true`**

Permanently delete a user from a realm. This cannot be undone. Requires confirm: true (ask the user first).

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user to delete, e.g. from user_search. |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `deleted` | `boolean` | True if the user was deleted. |
| `userId` | `string` | ID of the deleted user. |
| `realm` | `string` | Realm the user was deleted from. |

#### Send required-actions e-mail

`user_send_actions_email`

**sensitive · not idempotent · requires `confirm: true`**

Send the user an e-mail with a link to perform required actions (e.g. update password, verify e-mail). Whoever controls the e-mail address can use the link, so this requires confirm: true after the user approved the preview, which names the recipient address. Each call sends another e-mail. Requires SMTP to be configured in the realm and the user to have an e-mail address. The account this server signs in with cannot be targeted.

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=false`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user to e-mail. |
| `actions` | `"UPDATE_PASSWORD" \| "VERIFY_EMAIL" \| "CONFIGURE_TOTP" \| "UPDATE_PROFILE" \| "TERMS_AND_CONDITIONS"[]` | yes |   | Actions the user must perform via the e-mailed link. |
| `lifespan` | `integer (min 1, max 86400)` | no |   | Link validity in seconds, at most 86400 (24 hours). If omitted, the realm's setting for admin-initiated action links applies. |
| `clientId` | `string` | no |   | Client ID used for the redirect after the actions. |
| `redirectUri` | `string` | no |   | Redirect URI after the actions; requires clientId. |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `sent` | `boolean` | True if Keycloak accepted the e-mail request. |
| `userId` | `string` | ID of the user. |
| `realm` | `string` | Realm of the user. |
| `actions` | `string[]` | Actions requested in the e-mail. |

## Toolset `groups`

#### List groups

`group_list`

**read-only · idempotent**

List groups of a realm, optionally filtered by a search string, with pagination. Returns id, name, path and number of subgroups.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `search` | `string` | no |   | Only groups whose name contains this text. |
| `first` | `integer (min 0)` | no | `0` | Index of the first result to return (offset, default 0). |
| `max` | `integer (min 1, max 200)` | no | `50` | Maximum number of results (default 50, at most 200). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `items` | `object[]` |   |
| `items[].id` | `string` | Group ID (UUID); use it as `groupId` in other tools. |
| `items[].name` | `string` | Group name. |
| `items[].path` | `string` | Full group path, e.g. /parent/child. |
| `items[].subGroupCount` | `number` | Number of direct subgroups. |
| `first` | `integer` | Offset used for this page. |
| `max` | `integer` | Page size used for this page. |
| `hasMore` | `boolean` | True if more results exist beyond this page. |
| `realm` | `string` | Realm that was queried. |

#### List group members

`group_members_list`

**read-only · idempotent**

List the members of a group with a safe subset of user fields, with pagination.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `groupId` | `string` | yes |   | ID (UUID) of the group, e.g. from group_list. |
| `first` | `integer (min 0)` | no | `0` | Index of the first result to return (offset, default 0). |
| `max` | `integer (min 1, max 200)` | no | `50` | Maximum number of results (default 50, at most 200). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `items` | `object[]` |   |
| `items[].id` | `string` | User ID (UUID). |
| `items[].username` | `string` | Login name. |
| `items[].email` | `string` | E-mail address, if set. |
| `items[].firstName` | `string` | First name, if set. |
| `items[].lastName` | `string` | Last name, if set. |
| `items[].enabled` | `boolean` | Whether the user can log in. |
| `items[].emailVerified` | `boolean` | Whether the e-mail is verified. |
| `first` | `integer` | Offset used for this page. |
| `max` | `integer` | Page size used for this page. |
| `hasMore` | `boolean` | True if more results exist beyond this page. |
| `realm` | `string` | Realm that was queried. |
| `groupId` | `string` | Group that was queried. |

#### Add user to group

`user_group_add`

**sensitive · idempotent · requires `confirm: true`**

Add a user to a group. The user inherits the roles of the group and of all its parent groups, which can include administrative rights. Requires confirm: true after the user approved the preview. If the group grants administrative rights the preview says so and this confirmation cannot be turned off. The account this server signs in with cannot be added to groups. Adding a user who is already a member has no further effect.

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user. |
| `groupId` | `string` | yes |   | ID (UUID) of the group. |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `userId` | `string` | ID of the user. |
| `groupId` | `string` | ID of the group. |
| `realm` | `string` | Realm of the user and group. |
| `added` | `boolean` | True once the user is a member. |

#### Remove user from group

`user_group_remove`

**destructive · idempotent · requires `confirm: true`**

Remove a user from a group. This may revoke the roles the user inherits from the group. Requires confirm: true (ask the user first).

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user. |
| `groupId` | `string` | yes |   | ID (UUID) of the group. |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `userId` | `string` | ID of the user. |
| `groupId` | `string` | ID of the group. |
| `realm` | `string` | Realm of the user and group. |
| `removed` | `boolean` | True once the user is no member. |

## Toolset `roles`

#### List roles

`role_list`

**read-only · idempotent**

List realm roles, or the roles of one client when `clientId` is given, optionally filtered by a search string, with pagination.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `clientId` | `string` | no |   | Client ID (the readable `clientId`, not the internal UUID). Omit for realm roles. |
| `search` | `string` | no |   | Only roles whose name contains this text. |
| `first` | `integer (min 0)` | no | `0` | Index of the first result to return (offset, default 0). |
| `max` | `integer (min 1, max 200)` | no | `50` | Maximum number of results (default 50, at most 200). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `items` | `object[]` |   |
| `items[].name` | `string` | Role name. |
| `items[].description` | `string` | Role description, if set. |
| `items[].composite` | `boolean` | Whether the role is composite. |
| `items[].clientRole` | `boolean` | Whether this is a client role. |
| `first` | `integer` | Offset used for this page. |
| `max` | `integer` | Page size used for this page. |
| `hasMore` | `boolean` | True if more results exist beyond this page. |
| `realm` | `string` | Realm that was queried. |
| `clientId` | `string` | Client whose roles were listed, if any. |

#### List user role mappings

`user_roles_list`

**read-only · idempotent**

List the realm and client roles assigned to a user. With effective=true, composite roles are expanded; client roles are then resolved for `clientId` if given, otherwise for the clients the user has direct client-role mappings in. Optional `clientId` limits client roles to that client.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user. |
| `clientId` | `string` | no |   | Client ID (the readable `clientId`, not the internal UUID). Omit for realm roles. |
| `effective` | `boolean` | no | `false` | If true, include roles inherited via composite roles (default false). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `realm` | `string` | Realm of the user. |
| `userId` | `string` | ID of the user. |
| `effective` | `boolean` | Whether composite roles were expanded. |
| `realmRoles` | `object[]` | Realm roles of the user. |
| `realmRoles[].name` | `string` | Role name. |
| `realmRoles[].description` | `string` | Role description, if set. |
| `realmRoles[].composite` | `boolean` | Whether the role is composite. |
| `realmRoles[].clientRole` | `boolean` | Whether this is a client role. |
| `clientRoles` | `object[]` | Client roles of the user, grouped by client. |
| `clientRoles[].clientId` | `string` | Client the roles belong to. |
| `clientRoles[].roles` | `object[]` | Roles of the user in that client. |
| `clientRoles[].roles[].name` | `string` | Role name. |
| `clientRoles[].roles[].description` | `string` | Role description, if set. |
| `clientRoles[].roles[].composite` | `boolean` | Whether the role is composite. |
| `clientRoles[].roles[].clientRole` | `boolean` | Whether this is a client role. |

#### Assign roles to user

`user_role_assign`

**sensitive · idempotent · requires `confirm: true`**

Assign realm roles (or roles of one client when `clientId` is given) to a user. Unknown roles abort the call without changes. Requires confirm: true after the user approved the preview. If the roles grant administrative rights, directly or through composite roles, the preview says so and this confirmation cannot be turned off. Roles of the account this server signs in with cannot be changed.

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user. |
| `roles` | `string[]` | yes |   | Role names (not IDs), e.g. ['editor']. Use role_list to see available roles. |
| `clientId` | `string` | no |   | Client ID (the readable `clientId`, not the internal UUID). Omit for realm roles. |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `realm` | `string` | Realm of the user. |
| `userId` | `string` | ID of the user. |
| `clientId` | `string` | Client of the roles; absent for realm roles. |
| `roles` | `string[]` | Role names that were processed. |
| `assigned` | `boolean` | True once the roles are assigned. |

#### Revoke roles from user

`user_role_revoke`

**destructive · idempotent · requires `confirm: true`**

Remove realm roles (or roles of one client when `clientId` is given) from a user. Unknown roles abort the call without changes. Requires confirm: true (ask the user first).

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user. |
| `roles` | `string[]` | yes |   | Role names (not IDs), e.g. ['editor']. Use role_list to see available roles. |
| `clientId` | `string` | no |   | Client ID (the readable `clientId`, not the internal UUID). Omit for realm roles. |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `realm` | `string` | Realm of the user. |
| `userId` | `string` | ID of the user. |
| `clientId` | `string` | Client of the roles; absent for realm roles. |
| `roles` | `string[]` | Role names that were processed. |
| `revoked` | `boolean` | True once the roles are removed. |

## Toolset `clients`

#### List clients

`client_list`

**read-only · idempotent**

List clients of a realm with pagination, optionally filtered by clientId (prefix/infix search). Returns basic flags only; never secrets. Without the query-clients role, Keycloak before 26.8 silently returns only the clients the account holds roles of.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `search` | `string` | no |   | Search term matched against the clientId (substring match). |
| `first` | `integer (min 0)` | no | `0` | Index of the first result to return (offset, default 0). |
| `max` | `integer (min 1, max 200)` | no | `50` | Maximum number of results (default 50, at most 200). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `items` | `object[]` |   |
| `items[].id` | `string` | Internal client ID (UUID); use it as `id` in client_get. |
| `items[].clientId` | `string` | Public client identifier used in protocol requests. |
| `items[].name` | `string` | Display name, if set. |
| `items[].enabled` | `boolean` | Whether the client is enabled. |
| `items[].protocol` | `string` | Protocol, e.g. openid-connect or saml. |
| `items[].publicClient` | `boolean` | True for public clients (no client secret). |
| `items[].bearerOnly` | `boolean` | True if the client only accepts bearer tokens. |
| `items[].serviceAccountsEnabled` | `boolean` | Whether a service account is enabled. |
| `items[].standardFlowEnabled` | `boolean` | Whether the authorization code flow is on. |
| `items[].directAccessGrantsEnabled` | `boolean` | Whether the direct access (password) grant is on. |
| `first` | `integer` | Offset used for this page. |
| `max` | `integer` | Page size used for this page. |
| `hasMore` | `boolean` | True if more results exist beyond this page. |
| `realm` | `string` | Realm that was queried. |

#### Get client

`client_get`

**read-only · idempotent**

Get one client by internal `id` or by `clientId` (exactly one of them). Returns URLs, redirect URIs, web origins and client scope names. Secrets, attributes and protocol mapper configs are never returned.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `id` | `string` | no |   | Internal client ID (UUID) from client_list. |
| `clientId` | `string` | no |   | Public clientId, e.g. 'my-app'. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `id` | `string` | Internal client ID (UUID); use it as `id` in client_get. |
| `clientId` | `string` | Public client identifier used in protocol requests. |
| `name` | `string` | Display name, if set. |
| `enabled` | `boolean` | Whether the client is enabled. |
| `protocol` | `string` | Protocol, e.g. openid-connect or saml. |
| `publicClient` | `boolean` | True for public clients (no client secret). |
| `bearerOnly` | `boolean` | True if the client only accepts bearer tokens. |
| `serviceAccountsEnabled` | `boolean` | Whether a service account is enabled. |
| `standardFlowEnabled` | `boolean` | Whether the authorization code flow is on. |
| `directAccessGrantsEnabled` | `boolean` | Whether the direct access (password) grant is on. |
| `rootUrl` | `string` | Root URL, if set. |
| `baseUrl` | `string` | Base URL, if set. |
| `redirectUris` | `string[]` | Valid redirect URIs. |
| `webOrigins` | `string[]` | Allowed web origins (CORS). |
| `defaultClientScopes` | `string[]` | Default client scope names. |
| `optionalClientScopes` | `string[]` | Optional client scope names. |

## Toolset `sessions`

#### List user sessions

`user_sessions_list`

**read-only · idempotent**

List the active sessions of a user (IP address, start, last access, clients).

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user, e.g. from user_search. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `realm` | `string` | Realm that was queried. |
| `userId` | `string` | User ID that was queried. |
| `sessions` | `object[]` | Active sessions of the user. |
| `sessions[].id` | `string` | Session ID. |
| `sessions[].ipAddress` | `string` | IP address the session was started from. |
| `sessions[].start` | `number` | Session start (epoch milliseconds). |
| `sessions[].lastAccess` | `number` | Last access (epoch milliseconds). |
| `sessions[].clients` | `string[]` | Client IDs (clientId) taking part in the session. |

#### Log out user

`user_logout`

**destructive · idempotent · requires `confirm: true`**

End all active sessions of a user (forced logout). Offline tokens are not affected. Requires confirm: true (ask the user first).

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user, e.g. from user_search. |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `loggedOut` | `boolean` | True if the logout request was accepted. |
| `userId` | `string` | User whose sessions were ended. |
| `realm` | `string` | Realm of the user. |

## Toolset `events`

#### List login events

`event_list`

**read-only · idempotent**

List user/login events of a realm (logins, failed logins, logouts, password changes) with filters and pagination. Requires event storage to be enabled in the realm.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `type` | `string[]` | no |   | Event types to include, e.g. ['LOGIN', 'LOGIN_ERROR']. |
| `user` | `string` | no |   | Filter by user ID. |
| `client` | `string` | no |   | Filter by clientId. |
| `ipAddress` | `string` | no |   | Filter by source IP address. |
| `dateFrom` | `string` | no |   | Earliest event date (YYYY-MM-DD, inclusive). |
| `dateTo` | `string` | no |   | Latest event date (YYYY-MM-DD, inclusive). |
| `first` | `integer (min 0)` | no | `0` | Index of the first result to return (offset, default 0). |
| `max` | `integer (min 1, max 200)` | no | `50` | Maximum number of results (default 50, at most 200). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `items` | `object[]` |   |
| `items[].time` | `string` | Event time (ISO 8601). |
| `items[].type` | `string` | Event type, e.g. LOGIN or LOGIN_ERROR. |
| `items[].userId` | `string` | User ID, if known. |
| `items[].clientId` | `string` | Client involved, if known. |
| `items[].ipAddress` | `string` | Source IP address. |
| `items[].error` | `string` | Error code for failed events. |
| `items[].details` | `object` | Event details; tokens are removed. |
| `first` | `integer` | Offset used for this page. |
| `max` | `integer` | Page size used for this page. |
| `hasMore` | `boolean` | True if more results exist beyond this page. |
| `realm` | `string` | Realm that was queried. |

#### List admin events

`admin_event_list`

**read-only · idempotent**

List admin (audit) events of a realm: who changed which resource and when. The change payload is deliberately omitted. Requires admin events to be enabled in the realm.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `operationTypes` | `string[]` | no |   | Operation types to include: CREATE, UPDATE, DELETE, ACTION. |
| `resourceTypes` | `string[]` | no |   | Resource types to include, e.g. ['USER', 'CLIENT']. |
| `resourcePath` | `string` | no |   | Resource path filter; '*' wildcards allowed. |
| `authUser` | `string` | no |   | Filter by ID of the acting admin user. |
| `dateFrom` | `string` | no |   | Earliest event date (YYYY-MM-DD, inclusive). |
| `dateTo` | `string` | no |   | Latest event date (YYYY-MM-DD, inclusive). |
| `first` | `integer (min 0)` | no | `0` | Index of the first result to return (offset, default 0). |
| `max` | `integer (min 1, max 200)` | no | `50` | Maximum number of results (default 50, at most 200). |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `items` | `object[]` |   |
| `items[].time` | `string` | Event time (ISO 8601). |
| `items[].operationType` | `string` | CREATE, UPDATE, DELETE or ACTION. |
| `items[].resourceType` | `string` | Type of the changed resource, e.g. USER. |
| `items[].resourcePath` | `string` | Path of the changed resource. |
| `items[].authDetails` | `object` | Who performed the operation. |
| `items[].authDetails.userId` | `string` | Admin user who made the change. |
| `items[].authDetails.realmId` | `string` | Realm of the admin user. |
| `items[].authDetails.clientId` | `string` | Client used for the change. |
| `items[].authDetails.ipAddress` | `string` | Source IP address. |
| `items[].error` | `string` | Error code if the operation failed. |
| `first` | `integer` | Offset used for this page. |
| `max` | `integer` | Page size used for this page. |
| `hasMore` | `boolean` | True if more results exist beyond this page. |
| `realm` | `string` | Realm that was queried. |

## Toolset `security`

#### Get brute-force status

`user_brute_force_status`

**read-only · idempotent**

Show the brute-force detection state of a user: whether the account is temporarily locked and recent failure counters.

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user, e.g. from user_search. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `realm` | `string` | Realm that was queried. |
| `userId` | `string` | User ID that was queried. |
| `disabled` | `boolean` | True if the user is currently locked by brute-force detection. |
| `numFailures` | `number` | Number of consecutive failed logins. |
| `lastFailure` | `number` | Time of the last failure (epoch milliseconds). |
| `lastIPFailure` | `string` | IP address of the last failure. |

#### Unlock user (brute-force)

`user_brute_force_unlock`

**sensitive · idempotent · requires `confirm: true`**

Clear the brute-force detection state of a user so a temporarily locked account can log in again. This lifts a protection against password guessing, so it requires confirm: true after the user approved the preview. Does not change the user's enabled flag.

Annotations: `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=true`, `openWorldHint=false`

**Parameters**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `realm` | `string` | yes |   | Name of the target realm (the realm to operate on, not the login realm). |
| `userId` | `string` | yes |   | ID (UUID) of the user, e.g. from user_search. |
| `confirm` | `boolean` | no |   | Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved. |

**Output** (`structuredContent`)

| Name | Type | Description |
|---|---|---|
| `unlocked` | `boolean` | True if the brute-force state was cleared. |
| `userId` | `string` | User that was unlocked. |
| `realm` | `string` | Realm of the user. |

## Prompts

Prompts are guided workflows that instruct the model to use the tools above. They respect the realm allowlist and the `master` write protection.

### Audit realm security

`audit_realm_security`

Read-only security review of a realm (policies, admin roles, clients, events) that produces a prioritized list of findings.

| Argument | Required | Description |
|---|---|---|
| `realm` | yes | Name of the target realm. |

### Investigate failed logins

`investigate_failed_logins`

Analyze failed login events in a realm (optionally for one user), check lockout status and summarize patterns without changing anything.

| Argument | Required | Description |
|---|---|---|
| `realm` | yes | Name of the target realm. |
| `username` | no | Limit the analysis to this username. |
| `days` | no | Look-back window in days (default 7). |

### Offboard employee

`offboard_employee`

Guided workflow to safely deactivate a departing employee: review the account, end sessions and disable it (without deleting).

| Argument | Required | Description |
|---|---|---|
| `realm` | yes | Name of the target realm. |
| `username` | yes | Username of the departing employee. |

### Onboard employee

`onboard_employee`

Guided workflow to create a Keycloak user for a new employee, assign groups and roles and send the welcome e-mail.

| Argument | Required | Description |
|---|---|---|
| `realm` | yes | Name of the target realm. |
| `username` | yes | Username for the new account. |
| `email` | yes | E-mail address of the new employee. |
| `firstName` | yes | First name. |
| `lastName` | yes | Last name. |
| `groups` | no | Comma-separated list of group names to join. |
| `roles` | no | Comma-separated list of realm roles to assign. |

## Resources

Read-only JSON resources with the same guards as the tools. The `realm` variable supports completion.

| URI | Name | Description |
|---|---|---|
| `keycloak://realms` | Keycloak realms | Names of the realms this server may access (respects KEYCLOAK_MCP_REALMS). |
| `keycloak://realms/{realm}` | Keycloak realm settings | Safe subset of a realm's settings (same fields as the realm_get tool). |
| `keycloak://realms/{realm}/security-summary` | Realm security summary | Aggregated security posture of a realm: brute-force, password policy, SSL, OTP, event flags and client exposure counts. Contains no secrets. |
| `keycloak://realms/{realm}/users/{userId}` | Keycloak user | Safe subset of one user's fields (no attributes, no credentials). |
