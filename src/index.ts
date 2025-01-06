import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import KcAdminClient from '@keycloak/keycloak-admin-client';
import { z } from 'zod';

const server = new Server(
  {
    name: "keycloak-admin",
    version: "0.0.1",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize Keycloak client
const kcAdminClient = new KcAdminClient({
  baseUrl: process.env.KEYCLOAK_URL || 'http://localhost:8080',
  realmName: 'master'
});

// Tool schemas
const CreateUserSchema = z.object({
  realm: z.string(),
  username: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string()
});

const DeleteUserSchema = z.object({
  realm: z.string(),
  userId: z.string()
});

const ListUsersSchema = z.object({
  realm: z.string()
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create-user",
        description: "Create a new user in a specific realm",
        inputSchema: {
          type: "object",
          properties: {
            realm: { type: "string" },
            username: { type: "string" },
            email: { type: "string", format: "email" },
            firstName: { type: "string" },
            lastName: { type: "string" }
          },
          required: ["realm", "username", "email", "firstName", "lastName"]
        }
      },
      {
        name: "delete-user",
        description: "Delete a user from a specific realm",
        inputSchema: {
          type: "object",
          properties: {
            realm: { type: "string" },
            userId: { type: "string" }
          },
          required: ["realm", "userId"]
        }
      },
      {
        name: "list-realms",
        description: "List all available realms",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "list-users",
        description: "List users in a specific realm",
        inputSchema: {
          type: "object",
          properties: {
            realm: { type: "string" }
          },
          required: ["realm"]
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Authenticate before each request
  await kcAdminClient.auth({
    username: process.env.KEYCLOAK_ADMIN || 'admin',
    password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin',
    grantType: 'password',
    clientId: 'admin-cli',
  });

  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "create-user": {
        const { realm, username, email, firstName, lastName } = CreateUserSchema.parse(args);
        
        kcAdminClient.setConfig({
          realmName: realm
        });

        const user = await kcAdminClient.users.create({
          realm,
          username,
          email,
          firstName,
          lastName,
          enabled: true
        });

        return {
          content: [{
            type: "text",
            text: `User created successfully. User ID: ${user.id}`
          }]
        };
      }

      case "delete-user": {
        const { realm, userId } = DeleteUserSchema.parse(args);
        
        kcAdminClient.setConfig({
          realmName: realm
        });

        await kcAdminClient.users.del({
          id: userId,
          realm
        });

        return {
          content: [{
            type: "text",
            text: `User ${userId} deleted successfully from realm ${realm}`
          }]
        };
      }

      case "list-realms": {
        const realms = await kcAdminClient.realms.find();
        
        return {
          content: [{
            type: "text",
            text: `Available realms:\n${realms.map(r => `- ${r.realm}`).join('\n')}`
          }]
        };
      }

      case "list-users": {
        const { realm } = ListUsersSchema.parse(args);
        
        kcAdminClient.setConfig({
          realmName: realm
        });

        const users = await kcAdminClient.users.find();
        
        return {
          content: [{
            type: "text",
            text: `Users in realm ${realm}:\n${users.map(u => `- ${u.username} (${u.id})`).join('\n')}`
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Invalid arguments: ${error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")}`
        }]
      };
    }
    throw error;
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Keycloak MCP Server running on stdio");