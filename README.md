# Keycloak MCP Server

A Model Context Protocol server for Keycloak administration, providing tools to manage users and realms.

## Features

- Create new users in specific realms
- Delete users from realms
- List available realms
- List users in specific realms

## Installation

### Prerequisites

- Node.js 18 or higher
- Running Keycloak instance

### Setup

```bash
npm install
npm run build
```

### Configuration

Configure the server in your Claude Desktop configuration file:

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

## Deployment

### NPM Package

This project is set up for automated deployment to NPM via GitHub Actions. When a new release is published on GitHub:

1. The workflow automatically builds the package
2. Tests are run
3. The package is published to NPM if all checks pass

#### Setup Requirements

1. Create NPM account and get access token
2. Add NPM_TOKEN secret to GitHub repository
   - Go to repository Settings > Secrets
   - Add new secret named `NPM_TOKEN`
   - Paste your NPM access token as the value

### Using the Package

After deployment, install globally:

```bash
npm install -g keycloak-model-context-protocol
```
