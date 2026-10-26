/**
 * Minimal Keycloak permissions per tool, for documentation and for
 * role-matrix.test.ts, which proves each row against a real Keycloak.
 *
 * All roles are client roles of the `realm-management` client of the target
 * realm (a service account / user of the realm that is administered; for the
 * `master` realm the equivalent roles live in the `<realm>-realm` clients).
 *
 * status:
 *  - "tested":  role-matrix.test.ts verifies that the tool works with exactly
 *               these roles and fails with HTTP 403 for `deniedWith`.
 *  - "assumed": derived from Keycloak's admin REST permission checks, not
 *               exercised by the matrix test.
 */
export interface ToolRoleRequirement {
  tool: string;
  /** realm-management client roles; the tool must work with exactly these. */
  minimalRoles: readonly string[];
  /** A role set (possibly empty = no admin role at all) that must yield HTTP 403. */
  deniedWith: readonly string[];
  status: "tested" | "assumed";
  note?: string;
  /**
   * Keycloak before 26.8 filters some denied reads (only clients the account
   * holds roles of are visible) instead of answering HTTP 403. The protected
   * data must stay hidden, and a failed lookup must name the missing role.
   */
  deniedMayBeHidden?: boolean;
}

const t = (
  tool: string,
  minimalRoles: readonly string[],
  deniedWith: readonly string[] = [],
  status: ToolRoleRequirement["status"] = "tested",
  note?: string,
): ToolRoleRequirement => ({ tool, minimalRoles, deniedWith, status, ...(note && { note }) });

export const ROLE_MATRIX: readonly ToolRoleRequirement[] = [
  t(
    "realm_list",
    ["view-realm"],
    [],
    "assumed",
    "Lists only realms the account may see; no 403 for an account without roles.",
  ),
  t("realm_get", ["view-realm"]),
  t(
    "user_search",
    ["query-users"],
    ["view-clients"],
    "tested",
    "view-users also works; query-users is the narrower role.",
  ),
  t("user_get", ["view-users"], ["view-clients"]),
  t("user_create", ["manage-users"], ["view-users"]),
  t(
    "user_update",
    ["manage-users"],
    ["view-users"],
    "tested",
    "manage-users implies view access to users. Without view-clients the preview cannot tell whether the account has administrative rights.",
  ),
  t("user_delete", ["manage-users"], ["view-users"]),
  t(
    "user_send_actions_email",
    ["manage-users"],
    ["view-users"],
    "assumed",
    "Also needs SMTP configured in the realm. Without view-clients the preview cannot tell whether the account has administrative rights.",
  ),
  t("group_list", ["query-groups"], ["view-clients"]),
  t("group_members_list", ["view-users"], ["view-clients"]),
  t(
    "user_group_add",
    ["manage-users"],
    ["view-users"],
    "tested",
    "Without view-clients Keycloak hides client roles of groups, so every group membership needs a confirmation that cannot be turned off.",
  ),
  t("user_group_remove", ["manage-users"], ["view-users"]),
  t("role_list", ["view-realm"], []),
  t("user_roles_list", ["view-users"], ["view-clients"]),
  t(
    "user_role_assign",
    ["manage-users", "view-realm"],
    ["view-users", "view-realm"],
    "tested",
    "manage-users maps the role; view-realm lets the tool look the role up by name. Without view-clients, composite roles need a confirmation that cannot be turned off.",
  ),
  t(
    "user_role_revoke",
    ["manage-users", "view-realm"],
    ["view-users", "view-realm"],
    "tested",
    "Same as user_role_assign.",
  ),
  {
    ...t("client_list", ["query-clients"], ["view-users"]),
    deniedMayBeHidden: true,
  },
  {
    ...t("client_get", ["view-clients"], ["view-users"]),
    deniedMayBeHidden: true,
  },
  t("user_sessions_list", ["view-users"], ["view-clients"]),
  t("user_logout", ["manage-users"], ["view-users"]),
  t("event_list", ["view-events"], ["view-users"]),
  t("admin_event_list", ["view-events"], ["view-users"]),
  t("user_brute_force_status", ["view-users"], ["view-clients"]),
  t("user_brute_force_unlock", ["manage-users"], ["view-users"]),
];

export const ROLE_MATRIX_BY_TOOL: ReadonlyMap<string, ToolRoleRequirement> = new Map(
  ROLE_MATRIX.map((entry) => [entry.tool, entry]),
);
