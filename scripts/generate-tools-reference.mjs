#!/usr/bin/env node
/**
 * Generates docs/tools-reference.md from the live MCP server (tools/list,
 * prompts/list, resources/templates/list).
 *
 * Usage (after `npm run build`; the npm scripts do that for you):
 *   node scripts/generate-tools-reference.mjs           write the file
 *   node scripts/generate-tools-reference.mjs --check   exit 1 if the file is stale
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = resolve(root, "docs/tools-reference.md");
const check = process.argv.includes("--check");

const load = (path) => import(pathToFileURL(resolve(root, "dist", path)).href);

async function listAll(method, key) {
  const items = [];
  let cursor;
  do {
    const page = await method(cursor ? { cursor } : undefined);
    items.push(...page[key]);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function collect() {
  const { createServer } = await load("server.js");
  const { TOOLSETS } = await load("tools/index.js");
  const { TOOLSET_NAMES } = await load("config.js");
  const { silentLogger } = await load("logging.js");
  const { VERSION } = await load("version.js");

  const config = {
    url: "http://keycloak.invalid",
    authRealm: "master",
    credentials: { grantType: "client_credentials", clientId: "docs", clientSecret: "docs" },
    readOnly: false,
    allowedRealms: [],
    allowMasterWrite: false,
    toolsets: new Set(TOOLSET_NAMES),
    requireConfirmation: true,
    timeoutMs: 1000,
    logLevel: "error",
    warnings: [],
  };
  const gateway = {
    run() {
      throw new Error("The gateway must never be called while generating documentation.");
    },
  };
  const server = createServer({ config, gateway, logger: silentLogger });
  const client = new Client({ name: "docs-generator", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await listAll((p) => client.listTools(p), "tools");
    const prompts = await listAll((p) => client.listPrompts(p), "prompts");
    const resources = await listAll((p) => client.listResources(p), "resources");
    const templates = await listAll((p) => client.listResourceTemplates(p), "resourceTemplates");
    const toolsets = Object.entries(TOOLSETS).map(([name, defs]) => ({
      name,
      toolNames: defs.map((d) => d.name),
    }));
    return { tools, prompts, resources, templates, toolsets, version: VERSION };
  } finally {
    await client.close();
    await server.close();
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

const SAFE_INT = Number.MAX_SAFE_INTEGER;

const cell = (text) =>
  String(text ?? "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();

function typeOf(schema) {
  if (!schema || typeof schema !== "object") return "any";
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" \\| ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    const parts = [...new Set(variants.map(typeOf))];
    return parts.join(" \\| ");
  }
  const type = Array.isArray(schema.type) ? schema.type.join(" \\| ") : schema.type;
  if (type === "array") return `${typeOf(schema.items)}[]`;
  if (type === "integer" || type === "number") {
    const bounds = [];
    if (schema.minimum !== undefined && Math.abs(schema.minimum) < SAFE_INT) {
      bounds.push(`min ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && Math.abs(schema.maximum) < SAFE_INT) {
      bounds.push(`max ${schema.maximum}`);
    }
    return bounds.length > 0 ? `${type} (${bounds.join(", ")})` : type;
  }
  if (type === "string" && schema.format) return `string (${schema.format})`;
  return type ?? "any";
}

/** Flattens an object schema into rows; nested objects (also inside arrays) get dotted paths. */
function rowsOf(schema, prefix = "", depth = 0) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const rows = [];
  for (const [name, prop] of Object.entries(props)) {
    const path = `${prefix}${name}`;
    const nested = prop.type === "array" ? prop.items : prop;
    const isObject = nested?.type === "object" && nested.properties;
    rows.push({
      name: path,
      type: isObject && prop.type !== "array" ? "object" : typeOf(prop),
      required: required.has(name),
      def: prop.default,
      description: prop.description ?? "",
    });
    if (isObject && depth < 3) {
      const childPrefix = `${path}${prop.type === "array" ? "[]" : ""}.`;
      rows.push(...rowsOf(nested, childPrefix, depth + 1));
    }
  }
  return rows;
}

function table(rows, { withRequired }) {
  const head = withRequired
    ? ["Name", "Type", "Required", "Default", "Description"]
    : ["Name", "Type", "Description"];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const row of rows) {
    const cols = withRequired
      ? [
          `\`${row.name}\``,
          `\`${row.type}\``,
          row.required ? "yes" : "no",
          row.def === undefined ? "" : `\`${JSON.stringify(row.def)}\``,
          cell(row.description),
        ]
      : [`\`${row.name}\``, `\`${row.type}\``, cell(row.description)];
    lines.push(`| ${cols.map((c) => (c === "" ? " " : c)).join(" | ")} |`);
  }
  return lines.join("\n");
}

function badges(tool) {
  const a = tool.annotations ?? {};
  const out = [];
  if (a.readOnlyHint) out.push("read-only");
  else if (a.destructiveHint) out.push("destructive");
  else out.push("write");
  if (a.idempotentHint) out.push("idempotent");
  else if (!a.readOnlyHint) out.push("not idempotent");
  if (a.destructiveHint) out.push("requires `confirm: true`");
  return out;
}

function renderTool(tool) {
  const a = tool.annotations ?? {};
  const lines = [];
  lines.push(`#### ${tool.title ?? tool.name}`, "");
  lines.push(`\`${tool.name}\``, "");
  lines.push(`**${badges(tool).join(" · ")}**`, "");
  lines.push(tool.description ?? "", "");
  lines.push(
    `Annotations: \`readOnlyHint=${a.readOnlyHint}\`, \`destructiveHint=${a.destructiveHint}\`, \`idempotentHint=${a.idempotentHint}\`, \`openWorldHint=${a.openWorldHint}\``,
    "",
  );
  const params = rowsOf(tool.inputSchema);
  lines.push("**Parameters**", "");
  lines.push(params.length > 0 ? table(params, { withRequired: true }) : "_None._", "");
  const outputs = rowsOf(tool.outputSchema);
  lines.push("**Output** (`structuredContent`)", "");
  lines.push(outputs.length > 0 ? table(outputs, { withRequired: false }) : "_None._", "");
  return lines.join("\n");
}

function render({ tools, prompts, resources, templates, toolsets, version }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const out = [];
  out.push(
    "<!--",
    "  GENERATED FILE - DO NOT EDIT.",
    "  Source: tools/list, prompts/list and resources/templates/list of the built server.",
    "  Regenerate with `npm run docs:tools`; `npm run docs:check` fails when this file is stale.",
    "-->",
    "",
    "# Tools reference",
    "",
    `> Generated from the server definitions of version ${version}. Do not edit by hand.`,
    "",
    `The server exposes ${tools.length} tools in ${toolsets.length} toolsets, ${prompts.length} prompts and ${templates.length + resources.length} resources. Which tools are registered depends on \`KEYCLOAK_MCP_TOOLSETS\` (default: \`core,groups,roles\`) and \`KEYCLOAK_MCP_READ_ONLY\` (hides every tool that is not read-only). See [configuration](configuration.md).`,
    "",
    "Conventions:",
    "",
    "- Every tool takes the target `realm` explicitly. It is the realm to operate on, not the realm used for login.",
    "- Destructive tools take an additional optional `confirm` parameter. Unless `KEYCLOAK_MCP_REQUIRE_CONFIRMATION=false`, the first call returns a preview and changes nothing; call again with `confirm: true` after the user approved.",
    "- List tools are paginated with `first` and `max` and return `{ items, first, max, hasMore }`.",
    "- Results carry a short neutral summary in `content` and the data in `structuredContent`. Errors are returned with `isError: true`.",
    "",
    "## Overview",
    "",
    "| Toolset | Tool | Kind | Description |",
    "|---|---|---|---|",
  );
  for (const set of toolsets) {
    for (const name of set.toolNames) {
      const tool = byName.get(name);
      if (!tool) continue;
      const kind = tool.annotations?.readOnlyHint
        ? "read"
        : tool.annotations?.destructiveHint
          ? "destructive"
          : "write";
      const first = (tool.description ?? "").split(/(?<=\.)\s+(?=[A-Z])/)[0];
      out.push(`| \`${set.name}\` | [\`${name}\`](#${anchor(tool)}) | ${kind} | ${cell(first)} |`);
    }
  }
  out.push("");
  for (const set of toolsets) {
    out.push(`## Toolset \`${set.name}\``, "");
    for (const name of set.toolNames) {
      const tool = byName.get(name);
      if (tool) out.push(renderTool(tool));
    }
  }

  out.push("## Prompts", "");
  out.push(
    "Prompts are guided workflows that instruct the model to use the tools above. They respect the realm allowlist and the `master` write protection.",
    "",
  );
  for (const prompt of [...prompts].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push(`### ${prompt.title ?? prompt.name}`, "", `\`${prompt.name}\``, "");
    out.push(prompt.description ?? "", "");
    const args = prompt.arguments ?? [];
    if (args.length > 0) {
      out.push("| Argument | Required | Description |", "|---|---|---|");
      for (const arg of args) {
        out.push(`| \`${arg.name}\` | ${arg.required ? "yes" : "no"} | ${cell(arg.description)} |`);
      }
      out.push("");
    }
  }

  out.push("## Resources", "");
  out.push(
    "Read-only JSON resources with the same guards as the tools. The `realm` variable supports completion.",
    "",
    "| URI | Name | Description |",
    "|---|---|---|",
  );
  const resourceRows = [
    ...resources.map((r) => ({ uri: r.uri, title: r.title ?? r.name, description: r.description })),
    ...templates.map((t) => ({
      uri: t.uriTemplate,
      title: t.title ?? t.name,
      description: t.description,
    })),
  ].sort((a, b) => a.uri.localeCompare(b.uri));
  const seen = new Set();
  for (const row of resourceRows) {
    // Listed concrete instances of a template (e.g. one per realm) would make the output depend on data.
    if (seen.has(row.uri)) continue;
    seen.add(row.uri);
    out.push(`| \`${row.uri}\` | ${cell(row.title)} | ${cell(row.description)} |`);
  }
  out.push("");
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}`;
}

function anchor(tool) {
  return (tool.title ?? tool.name)
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ /g, "-");
}

const data = await collect();
const markdown = render(data);

if (check) {
  let current = "";
  try {
    current = await readFile(outFile, "utf8");
  } catch {
    // missing file counts as stale
  }
  if (current !== markdown) {
    process.stderr.write(
      "docs/tools-reference.md is out of date. Run `npm run docs:tools` and commit the result.\n",
    );
    process.exit(1);
  }
  process.stdout.write("docs/tools-reference.md is up to date.\n");
} else {
  await writeFile(outFile, markdown, "utf8");
  process.stdout.write(`Wrote docs/tools-reference.md (${data.tools.length} tools).\n`);
}
