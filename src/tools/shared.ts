import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  assertPathSegment,
  assertRealmAllowed,
  requireConfirmation,
  resolveWriteRealm,
} from "../guards.js";
import { mapKeycloakError, type ToolError } from "../keycloak/errors.js";
import type { KeycloakGateway } from "../keycloak/gateway.js";
import type { Logger } from "../logging.js";

/** Everything a tool handler may depend on. Injected, never global. */
export interface ToolContext {
  config: Config;
  gateway: KeycloakGateway;
  logger: Logger;
}

/**
 * read:        no side effects (readOnlyHint)
 * write:       changes state without touching identity, credentials, rights or protections
 * sensitive:   changes identity, credentials, rights or protection mechanisms; preview and `confirm: true`
 * destructive: deletes or irreversibly changes state; preview and `confirm: true`
 *
 * Sensitive and destructive tools are announced with destructiveHint, so clients
 * that ask before destructive calls also ask before these.
 */
export type ToolKind = "read" | "write" | "sensitive" | "destructive";

/** Kinds that get a `confirm` parameter, a preview and destructiveHint. */
export function needsConfirmation(kind: ToolKind): boolean {
  return kind === "sensitive" || kind === "destructive";
}

/** What the toolset registry needs to know; produced by defineTool(). */
export interface ToolDefinition {
  readonly name: string;
  readonly kind: ToolKind;
  register(server: McpServer, ctx: ToolContext): void;
}

// ---------------------------------------------------------------------------
// Shared schema building blocks
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const realmField = z
  .string()
  .min(1)
  .describe("Name of the target realm (the realm to operate on, not the login realm).");

export const confirmField = z
  .boolean()
  .optional()
  .describe(
    "Must be true to execute this operation. Never set it on the first call: call without it, show the returned preview to the user and only set it after the user approved.",
  );

export const paginationShape = {
  first: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Index of the first result to return (offset, default 0)."),
  max: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(
      `Maximum number of results (default ${DEFAULT_PAGE_SIZE}, at most ${MAX_PAGE_SIZE}).`,
    ),
};

/** Output schema wrapper for list tools: { items, first, max, hasMore }. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    first: z.number().int().describe("Offset used for this page."),
    max: z.number().int().describe("Page size used for this page."),
    hasMore: z.boolean().describe("True if more results exist beyond this page."),
  });
}

/**
 * Turns a result list fetched with `max + 1` rows into a page.
 * Query Keycloak with `max: max + 1` so hasMore can be detected without a count call.
 */
export function toPage<T>(rows: readonly T[], first: number, max: number) {
  return { items: rows.slice(0, max), first, max, hasMore: rows.length > max };
}

// ---------------------------------------------------------------------------
// Untrusted text
// ---------------------------------------------------------------------------

export const UNTRUSTED_MAX_LENGTH = 256;

/** C0/C1 control characters and the Unicode bidi controls (marks, embeddings, overrides, isolates). */
function isUnsafeCodePoint(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * Neutralises free text that comes from Keycloak (and therefore possibly from
 * an attacker): control characters and bidi controls become spaces, and text
 * longer than `max` code points is cut and marked with `…[truncated]`.
 */
export function untrusted(value: string, max = UNTRUSTED_MAX_LENGTH): string {
  const chars = Array.from(value, (char) =>
    isUnsafeCodePoint(char.codePointAt(0) ?? 0) ? " " : char,
  );
  return chars.length > max ? `${chars.slice(0, max).join("")}…[truncated]` : chars.join("");
}

/** untrusted() plus JSON quoting, for embedding values in previews and other server sentences. */
export function quoted(value: string, max = UNTRUSTED_MAX_LENGTH): string {
  return JSON.stringify(untrusted(value, max));
}

// ---------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------

export interface ToolOutput<T> {
  /** Validated against the tool's outputSchema and sent as structuredContent. */
  data: T;
  /** Short, neutral summary. Never put free text from Keycloak (names, descriptions) here. */
  summary: string;
}

/**
 * `executed` is the preview of a confirmable tool. It is echoed so the user can
 * see what ran, also when the model set `confirm: true` on its first call.
 */
export function toResult<T extends Record<string, unknown>>(
  output: ToolOutput<T>,
  executed?: { preview: string; confirmed: boolean },
): CallToolResult {
  const text =
    executed === undefined
      ? output.summary
      : `${output.summary}\n${executed.confirmed ? "Confirmed" : "Ran without confirmation (KEYCLOAK_MCP_REQUIRE_CONFIRMATION=false)"}: ${executed.preview}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: output.data,
  };
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function toToolError(error: unknown): ToolError {
  return mapKeycloakError(error);
}

// ---------------------------------------------------------------------------
// defineTool
// ---------------------------------------------------------------------------

export interface ToolSpec<I extends z.ZodObject, O extends z.ZodObject> {
  /** `<domain>_<verb>` in snake_case. */
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  /** Whether repeating the call with the same arguments has no further effect. Default: true for read/destructive, false for write. */
  idempotent?: boolean;
  /** Zod object with `.describe()` on every field. Do NOT add `confirm`; sensitive and destructive tools get it automatically. */
  input: I;
  output: O;
  /**
   * Required for sensitive and destructive tools: one sentence describing what
   * would happen. Runs on every call, also with `confirm: true`, and may reject
   * the call by throwing. Quote Keycloak free text with quoted().
   */
  preview?: (args: z.infer<I>, ctx: ToolContext) => PreviewResult | Promise<PreviewResult>;
  handler: (args: z.infer<I>, ctx: ToolContext) => Promise<ToolOutput<z.infer<O>>>;
}

export interface Preview {
  text: string;
  /** Confirmation required even with KEYCLOAK_MCP_REQUIRE_CONFIRMATION=false. */
  unconditional?: boolean;
}

export type PreviewResult = string | Preview;

type Auditable = { realm?: unknown; confirm?: unknown };

/**
 * Input fields that end up as URL path segments. Query-only fields such as the
 * public `clientId` (which may be a URL for SAML clients) are not listed.
 */
const PATH_SEGMENT_FIELDS = new Set(["realm", "id", "userId", "groupId"]);

/**
 * Builds a tool with all cross-cutting behaviour applied uniformly:
 * annotations, realm guards (allowlist, master write protection; for writes
 * applied to the realm Keycloak resolves the name to), path segment
 * validation, preview and confirmation for sensitive and destructive tools,
 * error mapping to isError,
 * and one audit log line per call (no arguments or PII logged).
 */
export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  spec: ToolSpec<I, O>,
): ToolDefinition {
  const confirmable = needsConfirmation(spec.kind);
  const preview = spec.preview;
  if (confirmable && !preview) {
    throw new Error(`Tool ${spec.name}: ${spec.kind} tools must define preview()`);
  }
  if (confirmable && "confirm" in spec.input.shape) {
    throw new Error(`Tool ${spec.name}: 'confirm' is added automatically for ${spec.kind} tools`);
  }
  const inputSchema = confirmable ? spec.input.extend({ confirm: confirmField }) : spec.input;
  const pathKeys = Object.keys(spec.input.shape).filter((key) => PATH_SEGMENT_FIELDS.has(key));
  const write = spec.kind !== "read";

  return {
    name: spec.name,
    kind: spec.kind,
    register(server, ctx) {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema,
          outputSchema: spec.output,
          annotations: {
            title: spec.title,
            readOnlyHint: spec.kind === "read",
            destructiveHint: confirmable,
            idempotentHint: spec.idempotent ?? spec.kind !== "write",
            openWorldHint: false,
          },
        },
        async (rawArgs): Promise<CallToolResult> => {
          const started = Date.now();
          const { confirm, ...rest } = rawArgs as z.infer<I> & Auditable;
          // Handlers and previews never see `confirm`, so it cannot leak into a request body.
          const args = rest as z.infer<I> & Auditable;
          let realm = typeof args.realm === "string" ? args.realm : undefined;
          let outcome = "ok";
          try {
            for (const key of pathKeys) {
              const value = (args as Record<string, unknown>)[key];
              if (typeof value === "string") assertPathSegment(value, key);
            }
            if (realm !== undefined && write) {
              // Previews, handlers and the audit line use the name Keycloak resolved.
              realm = (await resolveWriteRealm(ctx, realm)).name;
              args.realm = realm;
            } else if (realm !== undefined) {
              assertRealmAllowed(ctx.config, realm, { write: false });
            }
            let executed: { preview: string; confirmed: boolean } | undefined;
            if (confirmable && preview) {
              // Always computed, also with confirm: true on the first call, so
              // rejections apply and the result shows what was executed.
              const result = await preview(args, ctx);
              const { text, unconditional } =
                typeof result === "string" ? { text: result } : result;
              const confirmed = confirm === true;
              requireConfirmation(ctx.config, confirmed, text, {
                unconditional: unconditional === true,
              });
              executed = { preview: text, confirmed };
            }
            return toResult(await spec.handler(args, ctx), executed);
          } catch (error) {
            const toolError = mapKeycloakError(error, {
              baseUrl: ctx.config.url,
              authRealm: ctx.config.authRealm,
              timeoutMs: ctx.config.timeoutMs,
            });
            outcome = toolError.kind;
            if (toolError.kind === "unexpected") {
              ctx.logger.error("Unexpected tool failure", {
                tool: spec.name,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            return errorResult(toolError.message);
          } finally {
            ctx.logger.info("tool_call", {
              tool: spec.name,
              realm,
              outcome,
              durationMs: Date.now() - started,
            });
          }
        },
      );
    },
  };
}
