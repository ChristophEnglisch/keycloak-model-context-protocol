# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Use GitHub Private Vulnerability Reporting:
<https://github.com/ChristophEnglisch/keycloak-model-context-protocol/security/advisories/new>

Please include affected version, configuration (without secrets), reproduction steps and the expected impact.

### Response targets

These are goals, not guarantees. This is a volunteer-maintained project.
- Acknowledgement: within 5 business days
- Initial assessment: within 10 business days
- Fix or mitigation for confirmed high/critical issues: target 30 days

Reporters are credited in the advisory unless they prefer otherwise.

## Scope

In scope: the code in this repository and the published npm package `keycloak-model-context-protocol` (tool handlers, configuration handling, safety controls such as read-only mode, realm allowlist and confirmation of destructive tools, credential handling, logging).

Out of scope: vulnerabilities in Keycloak itself, in the MCP SDK or other dependencies (report upstream), misconfiguration such as over-privileged accounts, and attacks that require an already compromised host or MCP client.

## Security model

- The server acts with the Keycloak permissions of the configured account. Anything that account may do, the connected MCP client can do.
- Apply least privilege: use a dedicated service account (client credentials) with only the realm-management roles you need, never a `master` super admin for routine work.
- Restrict the blast radius:
  - `KEYCLOAK_MCP_READ_ONLY=true` registers read-only tools only.
  - `KEYCLOAK_MCP_REALMS` limits which realms may be targeted.
  - Writes in `master` are off unless `KEYCLOAK_MCP_ALLOW_MASTER_WRITE=true`.
  - Destructive and sensitive tools (every tool that changes data) require confirmation (`KEYCLOAK_MCP_REQUIRE_CONFIRMATION`, default `true`). Grants of administrative rights and changes to the server's own account always do.
  - Enable only the toolsets you need (`KEYCLOAK_MCP_TOOLSETS`).
- Prompt injection: data stored in Keycloak (names, attributes, descriptions) is untrusted input and may contain instructions aimed at the LLM. Keycloak data is returned as structured content, but the MCP client and model remain responsible for not following it. Keep a human in the loop for write operations and try the server against a test realm first.
- Secrets are read from environment variables only and must not appear in logs or tool output. Do not commit `.env` files.
