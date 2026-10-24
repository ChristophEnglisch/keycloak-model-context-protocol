import { z } from "zod";
import { ToolError } from "../keycloak/errors.js";
import { defineTool, realmField } from "./shared.js";

const userIdField = z.string().min(1).describe("ID (UUID) of the user, e.g. from user_search.");

const sessionItem = z.object({
  id: z.string().describe("Session ID."),
  ipAddress: z.string().optional().describe("IP address the session was started from."),
  start: z.number().optional().describe("Session start (epoch milliseconds)."),
  lastAccess: z.number().optional().describe("Last access (epoch milliseconds)."),
  clients: z.array(z.string()).describe("Client IDs (clientId) taking part in the session."),
});

const userSessionsList = defineTool({
  name: "user_sessions_list",
  title: "List user sessions",
  description: "List the active sessions of a user (IP address, start, last access, clients).",
  kind: "read",
  input: z.object({ realm: realmField, userId: userIdField }),
  output: z.object({
    realm: z.string().describe("Realm that was queried."),
    userId: z.string().describe("User ID that was queried."),
    sessions: z.array(sessionItem).describe("Active sessions of the user."),
  }),
  async handler({ realm, userId }, { gateway }) {
    const rows = await gateway.run((kc) => kc.users.listSessions({ realm, id: userId }));
    const sessions = rows.map((s) => ({
      id: s.id ?? "",
      ...(s.ipAddress !== undefined && { ipAddress: s.ipAddress }),
      ...(s.start !== undefined && { start: s.start }),
      ...(s.lastAccess !== undefined && { lastAccess: s.lastAccess }),
      clients: Object.values(s.clients ?? {}),
    }));
    return {
      data: { realm, userId, sessions },
      summary: `User ${userId} has ${sessions.length} active session(s) in realm '${realm}'.`,
    };
  },
});

const userLogout = defineTool({
  name: "user_logout",
  title: "Log out user",
  description:
    "End all active sessions of a user (forced logout). Offline tokens are not affected. Requires confirm: true (ask the user first).",
  kind: "destructive",
  idempotent: true,
  input: z.object({ realm: realmField, userId: userIdField }),
  output: z.object({
    loggedOut: z.boolean().describe("True if the logout request was accepted."),
    userId: z.string().describe("User whose sessions were ended."),
    realm: z.string().describe("Realm of the user."),
  }),
  async preview({ realm, userId }, { gateway }) {
    const { user, sessions } = await gateway.run(async (kc) => ({
      user: await kc.users.findOne({ realm, id: userId }),
      sessions: await kc.users.listSessions({ realm, id: userId }),
    }));
    if (!user)
      throw new ToolError("not_found", `User ${userId} does not exist in realm '${realm}'.`);
    return `end all sessions (${sessions.length} active) of user '${user.username ?? userId}' (id ${userId}) in realm '${realm}'.`;
  },
  async handler({ realm, userId }, { gateway }) {
    await gateway.run((kc) => kc.users.logout({ realm, id: userId }));
    return {
      data: { loggedOut: true, userId, realm },
      summary: `Ended all sessions of user ${userId} in realm '${realm}'.`,
    };
  },
});

export const sessionTools = [userSessionsList, userLogout];
