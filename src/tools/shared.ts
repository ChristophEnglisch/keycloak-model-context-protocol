import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Config } from "../config.js";
import { assertPathSegment, assertRealmAllowed, requireConfirmation } from "../guards.js";
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
 * write:       changes state, not destructive (create/update)
 * destructive: deletes or irreversibly changes state; requires `confirm: true`
 */
export type ToolKind = "read" | "write" | "destructive";

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
    "Must be true to execute this destructive operation. Only set it after the user approved.",
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
// Results and errors
// ---------------------------------------------------------------------------

export interface ToolOutput<T> {
  /** Validated against the tool's outputSchema and sent as structuredContent. */
  data: T;
  /** Short, neutral summary. Never put free text from Keycloak (names, descriptions) here. */
  summary: string;
}

export function toResult<T extends Record<string, unknown>>(output: ToolOutput<T>): CallToolResult {
  return {
    content: [{ type: "text", text: output.summary }],
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
  /** Zod object with `.describe()` on every field. Do NOT add `confirm`; destructive tools get it automatically. */
  input: I;
  output: O;
  /** Required for destructive tools: one sentence describing what would happen (shown before confirmation). */
  preview?: (args: z.infer<I>, ctx: ToolContext) => string | Promise<string>;
  handler: (args: z.infer<I>, ctx: ToolContext) => Promise<ToolOutput<z.infer<O>>>;
}

type Auditable = { realm?: unknown; confirm?: unknown };

/**
 * Input fields that end up as URL path segments. Query-only fields such as the
 * public `clientId` (which may be a URL for SAML clients) are not listed.
 */
const PATH_SEGMENT_FIELDS = new Set(["realm", "id", "userId", "groupId"]);

/**
 * Builds a tool with all cross-cutting behaviour applied uniformly:
 * annotations, realm guards (allowlist, master write protection), path segment
 * validation, confirmation for destructive tools, error mapping to isError,
 * and one audit log line per call (no arguments or PII logged).
 */
export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  spec: ToolSpec<I, O>,
): ToolDefinition {
  const destructive = spec.kind === "destructive";
  if (destructive && !spec.preview) {
    throw new Error(`Tool ${spec.name}: destructive tools must define preview()`);
  }
  if (destructive && "confirm" in spec.input.shape) {
    throw new Error(`Tool ${spec.name}: 'confirm' is added automatically for destructive tools`);
  }
  const inputSchema = destructive ? spec.input.extend({ confirm: confirmField }) : spec.input;
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
            destructiveHint: destructive,
            idempotentHint: spec.idempotent ?? spec.kind !== "write",
            openWorldHint: false,
          },
        },
        async (rawArgs): Promise<CallToolResult> => {
          const started = Date.now();
          const args = rawArgs as z.infer<I> & Auditable;
          const realm = typeof args.realm === "string" ? args.realm : undefined;
          let outcome = "ok";
          try {
            for (const key of pathKeys) {
              const value = (args as Record<string, unknown>)[key];
              if (typeof value === "string") assertPathSegment(value, key);
            }
            if (realm !== undefined) assertRealmAllowed(ctx.config, realm, { write });
            if (destructive && ctx.config.requireConfirmation && args.confirm !== true) {
              const preview = await (spec.preview as NonNullable<typeof spec.preview>)(args, ctx);
              requireConfirmation(ctx.config, args.confirm === true, preview);
            }
            return toResult(await spec.handler(args, ctx));
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
