export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level: LogLevel;
  /** Literal values that must never appear in output (passwords, client secrets). */
  secrets?: readonly string[];
  /** Output sink; defaults to stderr (stdout belongs to the MCP protocol). */
  write?: (line: string) => void;
}

const SENSITIVE_KEY = /secret|password|token|authorization|credential/i;
const MASK = "***";

/**
 * A secret plus the forms it takes when URL-encoded (in a path or query, or as
 * form data) or escaped inside JSON fields, longest first so a longer form is
 * never left half masked.
 */
function secretForms(secrets: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    forms.add(secret);
    forms.add(encodeURIComponent(secret));
    forms.add(new URLSearchParams({ s: secret }).toString().slice(2));
    forms.add(JSON.stringify(secret).slice(1, -1));
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

function maskSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) result = result.split(secret).join(MASK);
  }
  return result;
}

function serializeFields(
  fields: Record<string, unknown> | undefined,
  secrets: readonly string[],
): string {
  if (!fields) return "";
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    // String values are masked before JSON escaping can change how a secret looks.
    safe[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : typeof value === "string"
        ? maskSecrets(value, secrets)
        : value;
  }
  try {
    return ` ${JSON.stringify(safe)}`;
  } catch {
    return " [unserializable fields]";
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LOG_LEVELS.indexOf(options.level);
  const secrets = secretForms(options.secrets ?? []);
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));

  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${serializeFields(fields, secrets)}`;
    write(maskSecrets(line, secrets));
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
