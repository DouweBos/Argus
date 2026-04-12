/**
 * Central logging sink. Use these helpers instead of calling `console` directly
 * so eslint can forbid raw console usage outside this module.
 */
export function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console -- central logging sink
  console.log(...args);
}

export function info(...args: unknown[]): void {
  // eslint-disable-next-line no-console -- central logging sink
  console.info(...args);
}

export function warn(...args: unknown[]): void {
  // eslint-disable-next-line no-console -- central logging sink
  console.warn(...args);
}

export function error(...args: unknown[]): void {
  // eslint-disable-next-line no-console -- central logging sink
  console.error(...args);
}
