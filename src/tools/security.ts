import { z } from "zod";
import { ownAccountPreview, requireUser } from "./privileges.js";
import { defineTool, quoted, realmField } from "./shared.js";

const userIdField = z.string().min(1).describe("ID (UUID) of the user, e.g. from user_search.");

const userBruteForceStatus = defineTool({
  name: "user_brute_force_status",
  title: "Get brute-force status",
  description:
    "Show the brute-force detection state of a user: whether the account is temporarily locked and recent failure counters.",
  kind: "read",
  input: z.object({ realm: realmField, userId: userIdField }),
  output: z.object({
    realm: z.string().describe("Realm that was queried."),
    userId: z.string().describe("User ID that was queried."),
    disabled: z
      .boolean()
      .describe("True if the user is currently locked by brute-force detection."),
    numFailures: z.number().describe("Number of consecutive failed logins."),
    lastFailure: z.number().optional().describe("Time of the last failure (epoch milliseconds)."),
    lastIPFailure: z.string().optional().describe("IP address of the last failure."),
  }),
  async handler({ realm, userId }, { gateway }) {
    const st = await gateway.run((kc) => kc.attackDetection.findOne({ realm, id: userId }));
    const disabled = st?.disabled === true;
    const numFailures = typeof st?.numFailures === "number" ? st.numFailures : 0;
    return {
      data: {
        realm,
        userId,
        disabled,
        numFailures,
        ...(typeof st?.lastFailure === "number" && { lastFailure: st.lastFailure }),
        ...(typeof st?.lastIPFailure === "string" && { lastIPFailure: st.lastIPFailure }),
      },
      summary: `User ${userId} in realm '${realm}': ${disabled ? "locked" : "not locked"}, ${numFailures} failed login(s).`,
    };
  },
});

const userBruteForceUnlock = defineTool({
  name: "user_brute_force_unlock",
  title: "Unlock user (brute-force)",
  description:
    "Clear the brute-force detection state of a user so a temporarily locked account can log in again. This lifts a protection against password guessing, so it requires confirm: true after the user approved the preview. Does not change the user's enabled flag.",
  kind: "sensitive",
  idempotent: true,
  input: z.object({ realm: realmField, userId: userIdField }),
  output: z.object({
    unlocked: z.boolean().describe("True if the brute-force state was cleared."),
    userId: z.string().describe("User that was unlocked."),
    realm: z.string().describe("Realm of the user."),
  }),
  async preview({ realm, userId }, { gateway, config }) {
    return gateway.run(async (kc) => {
      const user = await requireUser(kc, realm, userId);
      const st = await kc.attackDetection.findOne({ realm, id: userId });
      const state =
        st?.disabled === true
          ? `currently locked after ${typeof st.numFailures === "number" ? st.numFailures : "?"} failed login(s)`
          : "currently not locked";
      return ownAccountPreview(
        kc,
        config,
        realm,
        user,
        `clear the brute-force lockout of user ${quoted(user.username ?? userId)} (id ${userId}, ${state}) in realm '${realm}'.`,
      );
    });
  },
  async handler({ realm, userId }, { gateway }) {
    await gateway.run((kc) => kc.attackDetection.del({ realm, id: userId }));
    return {
      data: { unlocked: true, userId, realm },
      summary: `Cleared brute-force state of user ${userId} in realm '${realm}'.`,
    };
  },
});

export const securityTools = [userBruteForceStatus, userBruteForceUnlock];
