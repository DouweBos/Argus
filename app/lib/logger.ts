/**
 * Central logging sink. Use these helpers instead of calling `console` directly
 * so eslint can forbid raw console usage outside this module.
 *
 * In the Electron main process `console.*` is patched in `electron/main.ts` to
 * tee every line to the app's log file. Calling through this module means a
 * scope prefix is prepended before that tee sees the message, so both the file
 * and the terminal share the same structured output.
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

function emit(level: LogLevel, scope: string | null, args: unknown[]): void {
  if (scope) {
    sinks[level](`[${scope}]`, ...args);

    return;
  }
  sinks[level](...args);
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
