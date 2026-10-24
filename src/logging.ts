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

function maskSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) result = result.split(secret).join(MASK);
  }
  return result;
}

function serializeFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) return "";
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : value;
  }
  try {
    return ` ${JSON.stringify(safe)}`;
  } catch {
    return " [unserializable fields]";
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LOG_LEVELS.indexOf(options.level);
  const secrets = options.secrets ?? [];
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));

  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${serializeFields(fields)}`;
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
