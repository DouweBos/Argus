/**
 * Central logging sink. Use these helpers instead of calling `console` directly
 * so eslint can forbid raw console usage outside this module.
 *
 * Calling through this module means a scope prefix is prepended to every line,
 * so the log file and the terminal share the same structured output.
 */

export type LogLevel = "debug" | "error" | "info" | "warn";

export interface Logger {
  child: (scope: string) => Logger;
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

/* eslint-disable no-console -- central logging sink */
const sinks: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: (...a) => console.debug(...a),
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};
/* eslint-enable no-console */

export type ErrorSink = (scope: string | null, args: unknown[]) => void;

let errorSink: ErrorSink | null = null;

/**
 * Register a callback invoked on every `log.error(...)`. Used by the telemetry
 * layer (main + renderer) to forward caught errors to PostHog as `app_error`
 * events. Kept as a registration hook to avoid a logger → telemetry import
 * cycle (telemetry already imports the logger).
 */
export function setErrorSink(sink: ErrorSink | null): void {
  errorSink = sink;
}

function emit(level: LogLevel, scope: string | null, args: unknown[]): void {
  if (scope) {
    sinks[level](`[${scope}]`, ...args);
  } else {
    sinks[level](...args);
  }
  if (level === "error" && errorSink) {
    try {
      errorSink(scope, args);
    } catch {
      // Never let telemetry break logging.
    }
  }
}

export function createLogger(scope: string): Logger {
  return {
    child: (sub) => createLogger(scope ? `${scope}:${sub}` : sub),
    debug: (...args) => emit("debug", scope, args),
    info: (...args) => emit("info", scope, args),
    warn: (...args) => emit("warn", scope, args),
    error: (...args) => emit("error", scope, args),
  };
}

export function log(...args: unknown[]): void {
  emit("info", null, args);
}

export function debug(...args: unknown[]): void {
  emit("debug", null, args);
}

export function info(...args: unknown[]): void {
  emit("info", null, args);
}

export function warn(...args: unknown[]): void {
  emit("warn", null, args);
}

export function error(...args: unknown[]): void {
  emit("error", null, args);
}
