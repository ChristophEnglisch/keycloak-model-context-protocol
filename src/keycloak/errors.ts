import { NetworkError } from "@keycloak/keycloak-admin-client";

export type ToolErrorKind =
  | "auth"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "bad_request"
  | "server"
  | "network"
  | "timeout"
  | "guard"
  | "confirmation_required"
  | "unexpected";

/** An error whose message is safe and useful to show to the model/user. */
export class ToolError extends Error {
  readonly kind: ToolErrorKind;
  readonly status: number | undefined;

  constructor(kind: ToolErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ToolError";
    this.kind = kind;
    this.status = status;
  }
}

export interface ErrorContext {
  /** "login" when the failure happened while obtaining a token. */
  phase?: "login" | "request";
  baseUrl?: string;
  authRealm?: string;
  timeoutMs?: number;
}

function detailFrom(data: unknown): string | undefined {
  if (typeof data === "string" && data.trim() !== "") return data.trim().slice(0, 300);
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["errorMessage", "error_description", "error", "message"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim().slice(0, 300);
    }
  }
  return undefined;
}

function withDetail(message: string, detail: string | undefined): string {
  return detail ? `${message} Keycloak says: ${detail}` : message;
}

export function httpStatusOf(error: unknown): number | undefined {
  return error instanceof NetworkError ? error.response.status : undefined;
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      (error.cause instanceof Error &&
        (error.cause.name === "TimeoutError" || error.cause.name === "AbortError")))
  );
}

function mapHttp(error: NetworkError, ctx: ErrorContext): ToolError {
  const status = error.response.status;
  const detail = detailFrom(error.responseData);
  if (ctx.phase === "login") {
    const realm = ctx.authRealm ?? "master";
    if (status === 400 || status === 401) {
      return new ToolError(
        "auth",
        withDetail(
          `Authentication against Keycloak realm '${realm}' failed (HTTP ${status}). Check KEYCLOAK_CLIENT_ID/KEYCLOAK_CLIENT_SECRET or KEYCLOAK_USERNAME/KEYCLOAK_PASSWORD and KEYCLOAK_AUTH_REALM.`,
          detail,
        ),
        status,
      );
    }
    if (status === 404) {
      return new ToolError(
        "auth",
        `Authentication realm '${realm}' or the token endpoint was not found (HTTP 404). Check KEYCLOAK_URL and KEYCLOAK_AUTH_REALM.`,
        status,
      );
    }
  }
  switch (status) {
    case 401:
      return new ToolError(
        "auth",
        "Keycloak rejected the access token (HTTP 401). The credentials may be invalid or the token expired.",
        status,
      );
    case 403:
      return new ToolError(
        "forbidden",
        withDetail(
          "Keycloak denied the operation (HTTP 403). The configured account lacks the required admin permissions (e.g. realm-management roles such as view-users, manage-users, view-realm) in the target realm.",
          detail,
        ),
        status,
      );
    case 404:
      return new ToolError(
        "not_found",
        withDetail(
          "Not found (HTTP 404). The realm or the requested resource does not exist.",
          detail,
        ),
        status,
      );
    case 409:
      return new ToolError(
        "conflict",
        withDetail("Conflict (HTTP 409). The resource already exists or is in conflict.", detail),
        status,
      );
    case 400:
    case 422:
      return new ToolError(
        "bad_request",
        withDetail(`Keycloak rejected the request as invalid (HTTP ${status}).`, detail),
        status,
      );
    default:
      if (status >= 500) {
        return new ToolError(
          "server",
          withDetail(`Keycloak reported a server error (HTTP ${status}).`, detail),
          status,
        );
      }
      return new ToolError(
        "unexpected",
        withDetail(`Unexpected response from Keycloak (HTTP ${status}).`, detail),
        status,
      );
  }
}

/** Idempotent: ToolErrors pass through unchanged. Never leaks stack traces or secrets. */
export function mapKeycloakError(error: unknown, ctx: ErrorContext = {}): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof NetworkError) return mapHttp(error, ctx);
  if (isTimeout(error)) {
    return new ToolError(
      "timeout",
      `The request to Keycloak timed out${ctx.timeoutMs ? ` after ${ctx.timeoutMs} ms` : ""}. Increase KEYCLOAK_MCP_TIMEOUT_MS or check the server.`,
    );
  }
  if (
    error instanceof TypeError ||
    (error instanceof Error &&
      /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|certificate/i.test(
        `${error.message} ${String(error.cause ?? "")}`,
      ))
  ) {
    return new ToolError(
      "network",
      `Cannot reach Keycloak${ctx.baseUrl ? ` at ${ctx.baseUrl}` : ""}. Check KEYCLOAK_URL, network connectivity and TLS settings.`,
    );
  }
  return new ToolError("unexpected", "An unexpected error occurred while talking to Keycloak.");
}
