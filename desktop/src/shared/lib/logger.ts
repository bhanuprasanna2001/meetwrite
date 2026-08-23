/**
 * Local, structured logging for the webview.
 *
 * Logs describe workflow boundaries and identifiers only. Note text, chat
 * content, transcripts, API keys, tokens, and audio payloads must never be
 * included in a context object.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogContext = Readonly<Record<string, unknown>>;

interface LoggerConfig {
  minimumLevel: LogLevel;
}

const LEVEL_RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };
let config: LoggerConfig = { minimumLevel: "info" };

export function configureLogger(next: Partial<LoggerConfig>): void {
  config = { ...config, ...next };
}

function enabled(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[config.minimumLevel];
}

function errorDetails(error: unknown): LogContext | undefined {
  if (error instanceof Error) return { errorName: error.name };
  if (typeof error === "string") return { errorType: "string" };
  return error === undefined ? undefined : { errorType: typeof error };
}

function write(
  level: LogLevel,
  event: string,
  context?: LogContext,
  error?: unknown,
): void {
  if (!enabled(level)) return;
  const details = { ...context, ...errorDetails(error) };
  const output = Object.keys(details).length === 0 ? undefined : details;
  const label = `[meetwrite] ${event}`;
  if (level === "info") {
    if (output) console.info(label, output);
    else console.info(label);
  } else if (level === "warn") {
    if (output) console.warn(label, output);
    else console.warn(label);
  } else if (output) console.error(label, output);
  else console.error(label);
}

export const log = {
  info(event: string, context?: LogContext): void {
    write("info", event, context);
  },
  warn(event: string, context?: LogContext, error?: unknown): void {
    write("warn", event, context, error);
  },
  error(event: string, context?: LogContext, error?: unknown): void {
    write("error", event, context, error);
  },
};
