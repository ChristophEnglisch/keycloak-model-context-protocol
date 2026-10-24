import { randomUUID } from "node:crypto";
import KcAdminClient from "@keycloak/keycloak-admin-client";
import { keycloak } from "./context.js";

/** Fresh master-realm admin client (short-lived token, so authenticate per use). */
export async function adminClient(): Promise<KcAdminClient> {
  const k = keycloak();
  const kc = new KcAdminClient({ baseUrl: k.url, realmName: "master" });
  await kc.auth({
    grantType: "password",
    clientId: "admin-cli",
    username: k.adminUser,
    password: k.adminPassword,
  });
  return kc;
}

export interface ServiceAccount {
  realm: string;
  clientId: string;
  secret: string;
  /** Internal client UUID. */
  id: string;
}

/**
 * Creates a service-account client in `realm` that holds exactly the given
 * `realm-management` client roles (none if the list is empty).
 */
export async function createServiceAccount(
  realm: string,
  roles: readonly string[],
): Promise<ServiceAccount> {
  const kc = await adminClient();
  const suffix = randomUUID().slice(0, 8);
  const clientId = `sa-${suffix}`;
  const secret = `secret-${randomUUID()}`;
  const { id } = await kc.clients.create({
    realm,
    clientId,
    secret,
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
  });
  if (roles.length > 0) {
    const [management] = await kc.clients.find({ realm, clientId: "realm-management" });
    if (!management?.id) throw new Error(`realm-management client missing in ${realm}`);
    const available = await kc.clients.listRoles({ realm, id: management.id });
    const wanted = available.filter((r) => r.name !== undefined && roles.includes(r.name));
    if (wanted.length !== roles.length) {
      throw new Error(
        `Unknown realm-management role(s) in ${roles.join(", ")}; available: ${available.map((r) => r.name).join(", ")}`,
      );
    }
    const serviceUser = await kc.clients.getServiceAccountUser({ realm, id });
    if (!serviceUser.id) throw new Error("service account user has no id");
    await kc.users.addClientRoleMappings({
      realm,
      id: serviceUser.id,
      clientUniqueId: management.id,
      roles: wanted.map((r) => ({ id: r.id as string, name: r.name as string })),
    });
  }
  return { realm, clientId, secret, id };
}

export async function deleteClient(realm: string, id: string): Promise<void> {
  const kc = await adminClient();
  await kc.clients.del({ realm, id });
}

export async function findUserId(realm: string, username: string): Promise<string> {
  const kc = await adminClient();
  const [user] = await kc.users.find({ realm, username, exact: true });
  if (!user?.id) throw new Error(`User ${username} not found in ${realm}`);
  return user.id;
}

/** Creates a throw-away user directly through the admin API (test preparation). */
export async function createUser(
  realm: string,
  prefix = "tmp",
): Promise<{ id: string; username: string }> {
  const kc = await adminClient();
  const username = `${prefix}-${randomUUID().slice(0, 8)}`;
  const { id } = await kc.users.create({
    realm,
    username,
    enabled: true,
    email: `${username}@it.example.test`,
    firstName: "Temp",
    lastName: "User",
  });
  return { id, username };
}

export async function deleteUsersByPrefix(realm: string, prefix: string): Promise<void> {
  const kc = await adminClient();
  const users = await kc.users.find({ realm, search: prefix, max: 200 });
  for (const user of users) {
    if (user.id && user.username?.startsWith(prefix)) await kc.users.del({ realm, id: user.id });
  }
}

export async function realmNames(): Promise<string[]> {
  const kc = await adminClient();
  return (await kc.realms.find({ briefRepresentation: true })).map((r) => r.realm as string);
}

/** Resource-owner password login through the it-app client. Returns the HTTP status. */
export async function passwordLogin(
  realm: string,
  username: string,
  password: string,
): Promise<number> {
  const response = await fetch(`${keycloak().url}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "it-app",
      client_secret: "it-app-secret",
      username,
      password,
    }),
  });
  await response.arrayBuffer();
  return response.status;
}
