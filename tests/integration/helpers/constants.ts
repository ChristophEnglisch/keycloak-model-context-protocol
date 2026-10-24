/** Names and credentials that come from tests/integration/fixtures/*.json. */
export const REALM = "it-realm";
export const REALM_B = "it-realm-b";

export const USERS = {
  alice: { username: "alice", password: "alice-pw" },
  bob: { username: "bob", password: "bob-pw" },
  carol: { username: "carol", password: "carol-pw" },
  locky: { username: "locky", password: "locky-pw" },
  /** Has the realm-admin composite of realm-management in it-realm. */
  admin: { username: "it-admin", password: "it-admin-pw" },
} as const;

export const CLIENTS = {
  app: { clientId: "it-app", secret: "it-app-secret" },
  /** Service account with view-users, query-users, view-realm, view-clients, query-groups. */
  service: { clientId: "it-service", secret: "it-service-secret" },
} as const;

export const ZED = "zed";
