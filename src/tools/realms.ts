import type KcAdminClient from "@keycloak/keycloak-admin-client";
import { z } from "zod";
import { isRealmAllowed } from "../guards.js";
import { ToolError } from "../keycloak/errors.js";
import { defineTool, pageOf, paginationShape, realmField, toPage } from "./shared.js";

const realmSummary = z.object({
  realm: z.string().describe("Realm name (use this as the `realm` argument of other tools)."),
  displayName: z.string().optional().describe("Human-readable realm name."),
  enabled: z.boolean().optional().describe("Whether the realm is enabled."),
});

const realmList = defineTool({
  name: "realm_list",
  title: "List realms",
  description:
    "List the Keycloak realms visible to the configured admin account (restricted to KEYCLOAK_MCP_REALMS if set). Returns names only, not realm settings.",
  kind: "read",
  input: z.object(paginationShape),
  output: pageOf(realmSummary),
  async handler({ first, max }, { gateway, config }) {
    const realms = await gateway.run((kc) => kc.realms.find({ briefRepresentation: true }));
    const visible = realms
      .filter((r) => r.realm !== undefined && isRealmAllowed(config, r.realm))
      .sort((a, b) => (a.realm ?? "").localeCompare(b.realm ?? ""))
      .map((r) => ({
        realm: r.realm as string,
        ...(r.displayName ? { displayName: r.displayName } : {}),
        ...(r.enabled !== undefined ? { enabled: r.enabled } : {}),
      }));
    const page = toPage(visible.slice(first, first + max + 1), first, max);
    return { data: page, summary: `Returned ${page.items.length} of ${visible.length} realm(s).` };
  },
});

const realmGet = defineTool({
  name: "realm_get",
  title: "Get realm settings",
  description:
    "Get a safe subset of a realm's settings (login, session, brute-force, password policy and event flags). SMTP credentials, keys and other secrets are never returned.",
  kind: "read",
  input: z.object({ realm: realmField }),
  output: z.object({
    realm: z.string().describe("Realm name."),
    displayName: z.string().optional().describe("Human-readable realm name."),
    enabled: z.boolean().optional().describe("Whether the realm is enabled."),
    sslRequired: z.string().optional().describe("SSL requirement: all, external or none."),
    registrationAllowed: z.boolean().optional().describe("Whether self-registration is allowed."),
    loginWithEmailAllowed: z.boolean().optional().describe("Whether users may log in with e-mail."),
    duplicateEmailsAllowed: z
      .boolean()
      .optional()
      .describe("Whether duplicate e-mails are allowed."),
    resetPasswordAllowed: z.boolean().optional().describe("Whether 'forgot password' is enabled."),
    verifyEmail: z.boolean().optional().describe("Whether e-mail verification is required."),
    bruteForceProtected: z.boolean().optional().describe("Whether brute-force detection is on."),
    passwordPolicy: z.string().optional().describe("Password policy expression."),
    otpPolicyType: z.string().optional().describe("OTP type: totp or hotp."),
    accessTokenLifespan: z.number().optional().describe("Access token lifespan in seconds."),
    ssoSessionIdleTimeout: z.number().optional().describe("SSO session idle timeout in seconds."),
    ssoSessionMaxLifespan: z.number().optional().describe("SSO session max lifespan in seconds."),
    eventsEnabled: z.boolean().optional().describe("Whether login events are stored."),
    adminEventsEnabled: z.boolean().optional().describe("Whether admin events are stored."),
  }),
  async handler({ realm }, { gateway }) {
    const rep = await gateway.run((kc) => kc.realms.findOne({ realm }));
    if (!rep) throw new ToolError("not_found", `Realm '${realm}' does not exist.`);
    const data = toRealmSettings(rep, realm);
    return { data, summary: `Returned settings of realm '${realm}'.` };
  },
});

/** Field allowlist for realm settings; SMTP credentials, keys and secrets never pass. */
export const REALM_SETTING_FIELDS = [
  "displayName",
  "enabled",
  "sslRequired",
  "registrationAllowed",
  "loginWithEmailAllowed",
  "duplicateEmailsAllowed",
  "resetPasswordAllowed",
  "verifyEmail",
  "bruteForceProtected",
  "passwordPolicy",
  "otpPolicyType",
  "accessTokenLifespan",
  "ssoSessionIdleTimeout",
  "ssoSessionMaxLifespan",
  "eventsEnabled",
  "adminEventsEnabled",
] as const;

type RealmRep = NonNullable<Awaited<ReturnType<KcAdminClient["realms"]["findOne"]>>>;

/** Safe subset of a realm representation, shared by realm_get and the realm resource. */
export function toRealmSettings(rep: RealmRep, realm: string) {
  const data: { realm: string } & Partial<Pick<RealmRep, (typeof REALM_SETTING_FIELDS)[number]>> = {
    realm: rep.realm ?? realm,
  };
  for (const key of REALM_SETTING_FIELDS) {
    const value = rep[key];
    if (value !== undefined && value !== null) Object.assign(data, { [key]: value });
  }
  return data;
}

export const realmTools = [realmList, realmGet];
