# Keycloak MCP Server

A Model Context Protocol server for Keycloak administration, providing tools to manage users and realms.

## Features

- Create new users in specific realms
- Delete users from realms
- List available realms
- List users in specific realms

## Installation

### Via NPM (Recommended)

The server is available as an NPM package:
```bash
# Direct usage with npx
npx -y keycloak-model-context-protocol

# Or global installation
npm install -g keycloak-model-context-protocol
```

### Local Development Setup

If you want to develop or modify the server:

```bash
git clone <repository-url>
cd keycloak-model-context-protocol
npm install
npm run build
```

## Configuration

### Using NPM Package (Recommended)
Configure the server in your Claude Desktop configuration file:

```json
{
  "mcpServers": {
    "keycloak": {
      "command": "npx",
      "args": ["-y", "keycloak-model-context-protocol"],
      "env": {
        "KEYCLOAK_URL": "http://localhost:8080",
        "KEYCLOAK_ADMIN": "admin",
        "KEYCLOAK_ADMIN_PASSWORD": "admin"
      }
    }
  }
}
```

### For Local Development
```json
{
  "mcpServers": {
    "keycloak": {
      "command": "node",
      "args": ["path/to/dist/index.js"],
      "env": {
        "KEYCLOAK_URL": "http://localhost:8080",
        "KEYCLOAK_ADMIN": "admin",
        "KEYCLOAK_ADMIN_PASSWORD": "admin"
      }
    }
  }
}
```

## Available Tools

### create-user
Creates a new user in a specified realm.

**Inputs**:
- `realm`: The realm name
- `username`: Username for the new user
- `email`: Email address for the user
- `firstName`: User's first name
- `lastName`: User's last name

### delete-user
Deletes a user from a specified realm.

**Inputs**:
- `realm`: The realm name
- `userId`: The ID of the user to delete

### list-realms
Lists all available realms.

### list-users
Lists all users in a specified realm.

**Inputs**:
- `realm`: The realm name

## Development

```bash
npm run watch
```

## Testing

To test the server using MCP Inspector:

```bash
npx -y @modelcontextprotocol/inspector npx -y keycloak-model-context-protocol
```

## Deployment

### NPM Package

This project is automatically published to [NPM](https://www.npmjs.com/package/keycloak-model-context-protocol) via GitHub Actions when a new release is published on GitHub.

#### Setup Requirements for Deployment

1. Create NPM account and get access token
2. Add NPM_TOKEN secret to GitHub repository
   - Go to repository Settings > Secrets
   - Add new secret named `NPM_TOKEN`
   - Paste your NPM access token as the value

## Prerequisites

- Node.js 18 or higher
- Running Keycloak instance
