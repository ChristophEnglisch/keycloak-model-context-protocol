# MCP client configuration

The server is a standard **stdio** MCP server, started with `npx -y keycloak-model-context-protocol@1` (Node.js 22 or newer). All snippets use the recommended `client_credentials` login with a service-account client; see [getting-started.md](getting-started.md) for creating it and [configuration.md](configuration.md) for every variable.

Common placeholders:

| Placeholder | Meaning |
| --- | --- |
| `https://keycloak.example.com` | Your Keycloak base URL |
| `demo` | Realm in which the client `mcp-admin` lives (`KEYCLOAK_AUTH_REALM`) |
| `mcp-admin` | Client ID of the service-account client |
| `<client-secret>` | The client secret. Never commit it. |

Optional settings (`KEYCLOAK_MCP_READ_ONLY`, `KEYCLOAK_MCP_REALMS`, `KEYCLOAK_MCP_TOOLSETS`, ...) go into the same `env` block. A sensible start is `"KEYCLOAK_MCP_READ_ONLY": "true"`.

## How to handle the secret

| Client | Secret handling | Plain text in a file? |
| --- | --- | --- |
| Claude Code | `${VAR}` expansion from your shell environment | no |
| VS Code | `inputs` with `promptString` (password), asked once and stored by VS Code | no |
| Cursor | `${env:VAR}` interpolation | no |
| Claude Desktop | no variable expansion; use a wrapper script that reads from a keychain, or accept a plain-text config file | yes, unless you use the wrapper |
| Generic / others | environment of the launching process | depends |

## Claude Desktop

Edit `claude_desktop_config.json` (Settings > Developer > Edit Config; macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`) and restart Claude Desktop.

```json
{
  "mcpServers": {
    "keycloak": {
      "command": "npx",
      "args": ["-y", "keycloak-model-context-protocol@1"],
      "env": {
        "KEYCLOAK_URL": "https://keycloak.example.com",
        "KEYCLOAK_AUTH_REALM": "demo",
        "KEYCLOAK_CLIENT_ID": "mcp-admin",
        "KEYCLOAK_CLIENT_SECRET": "<client-secret>"
      }
    }
  }
}
```

Claude Desktop passes `env` values literally, so the secret sits in this file. Restrict the file's permissions (`chmod 600` on macOS and Linux), or keep the secret out of it with a small wrapper script. Example for macOS, with the secret stored in the Keychain (`security add-generic-password -a "$USER" -s keycloak-mcp -w`):

```bash
#!/bin/sh
# ~/bin/keycloak-mcp.sh   (chmod +x)
export KEYCLOAK_CLIENT_SECRET="$(security find-generic-password -s keycloak-mcp -w)"
exec npx -y keycloak-model-context-protocol@1
```

```json
{
  "mcpServers": {
    "keycloak": {
      "command": "/Users/you/bin/keycloak-mcp.sh",
      "env": {
        "KEYCLOAK_URL": "https://keycloak.example.com",
        "KEYCLOAK_AUTH_REALM": "demo",
        "KEYCLOAK_CLIENT_ID": "mcp-admin"
      }
    }
  }
}
```

Notes:

- Claude Desktop starts GUI-launched processes with a minimal `PATH`. If `npx` is not found, use the absolute path (for example from `which npx`) as `command`.
- On Windows, if `npx` cannot be started directly, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "keycloak-model-context-protocol@1"]`.
- For a local build use `"command": "node"` and `"args": ["/absolute/path/to/dist/index.js"]`.
- Prompts show up in the attachment menu of a chat; resources can be attached from the same menu.

## Claude Code

```bash
export KEYCLOAK_CLIENT_SECRET='<client-secret>'

claude mcp add --transport stdio \
  --env KEYCLOAK_URL=https://keycloak.example.com \
  --env KEYCLOAK_AUTH_REALM=demo \
  --env KEYCLOAK_CLIENT_ID=mcp-admin \
  --env KEYCLOAK_CLIENT_SECRET='${KEYCLOAK_CLIENT_SECRET}' \
  keycloak -- npx -y keycloak-model-context-protocol@1
```

Keep the single quotes around `'${KEYCLOAK_CLIENT_SECRET}'`: the literal `${...}` is stored in the configuration and expanded by Claude Code when it starts the server, so the secret itself is never written to the config. The variable has to exist in the shell from which you start `claude`.

- Scope: `--scope local` (default, only you in this project), `--scope project` (writes `.mcp.json`, shareable and safe to commit because it contains no secret) or `--scope user` (all your projects).
- Check with `claude mcp list` and, inside a session, `/mcp`.
- Prompts are available as slash commands such as `/mcp__keycloak__audit_realm_security`.
- Read-only trial: add `--env KEYCLOAK_MCP_READ_ONLY=true`.

## VS Code

Create `.vscode/mcp.json` in the workspace (or use the user-level MCP configuration). The `inputs` entry makes VS Code ask for the secret once and keeps it out of the file.

```jsonc
{
  "inputs": [
    {
      "type": "promptString",
      "id": "kc-client-secret",
      "description": "Keycloak MCP client secret",
      "password": true
    }
  ],
  "servers": {
    "keycloak": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "keycloak-model-context-protocol@1"],
      "env": {
        "KEYCLOAK_URL": "https://keycloak.example.com",
        "KEYCLOAK_AUTH_REALM": "demo",
        "KEYCLOAK_CLIENT_ID": "mcp-admin",
        "KEYCLOAK_CLIENT_SECRET": "${input:kc-client-secret}"
      }
    }
  }
}
```

Start the server from the code lens above `"keycloak"` in the file or via the command palette (*MCP: List Servers*). Tools appear in Copilot Chat in agent mode; prompts are available as `/` commands.

## Cursor

Create `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` globally). Values are interpolated from your environment, so export the variables before starting Cursor.

```jsonc
{
  "mcpServers": {
    "keycloak": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "keycloak-model-context-protocol@1"],
      "env": {
        "KEYCLOAK_URL": "https://keycloak.example.com",
        "KEYCLOAK_AUTH_REALM": "demo",
        "KEYCLOAK_CLIENT_ID": "mcp-admin",
        "KEYCLOAK_CLIENT_SECRET": "${env:KEYCLOAK_CLIENT_SECRET}"
      }
    }
  }
}
```

Enable the server under *Settings > MCP*. A Cursor started from the Dock or Start menu does not see variables exported in a terminal; start it from a shell (`cursor .`) or set the variable system-wide.

## Generic stdio client

Any MCP client that can start a stdio server works. Provide:

| Field | Value |
| --- | --- |
| Command | `npx` |
| Arguments | `-y keycloak-model-context-protocol@1` |
| Transport | stdio |
| Environment | `KEYCLOAK_URL`, `KEYCLOAK_AUTH_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` |

Or from a shell, for example to test:

```bash
KEYCLOAK_URL=https://keycloak.example.com \
KEYCLOAK_AUTH_REALM=demo \
KEYCLOAK_CLIENT_ID=mcp-admin \
KEYCLOAK_CLIENT_SECRET='<client-secret>' \
npx -y keycloak-model-context-protocol@1
```

The process then waits for JSON-RPC on stdin; logs go to stderr. Interactive testing is easier with the [MCP Inspector](getting-started.md#4-test-with-the-mcp-inspector).

## Password grant instead (not recommended)

If you cannot use a service account, replace the three client variables with a user login:

```text
KEYCLOAK_USERNAME=mcp-service-user
KEYCLOAK_PASSWORD=<password>        # same secret-handling rules as above
KEYCLOAK_AUTH_REALM=master          # realm of the user
```

The client defaults to `admin-cli`. See [configuration.md](configuration.md#password).

## Troubleshooting a client setup

- **Server not listed / fails to start:** run the same command with the same variables in a terminal; configuration errors are printed to stderr and the process exits. See [troubleshooting.md](troubleshooting.md).
- **`npx` not found or wrong Node version:** the client's `PATH` may differ from your shell. Use absolute paths, and make sure `node --version` shows 22 or newer for that `PATH`.
- **Secret not applied:** check that the variable is exported in the environment of the process that starts the client (Claude Code: your shell; Cursor: the shell that launched it).
