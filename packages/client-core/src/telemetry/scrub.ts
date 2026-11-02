/**
 * Strip what identifies a person or a machine from an error before it is
 * sent: home directories and device container paths. The patterns of the
 * phone's `Telemetry.scrub` and the desktop renderer's `scrubMessage`.
 */

const PATTERNS: [RegExp, string][] = [
  [/\/Users\/[^/\s'")]+/g, "/Users/<user>"],
  [/\/home\/[^/\s'")]+/g, "/home/<user>"],
  [/[A-Z]:\\Users\\[^\\\s'")]+/g, "C:\\Users\\<user>"],
  [/\/var\/mobile\/Containers\/[^\s'")]+/g, "/var/mobile/Containers/<path>"],
  [/\/private\/var\/[^\s'")]+/g, "/private/var/<path>"],
];

/** Longest message or stack sent, as on the phone. */
export const SCRUBBED_MAX_LENGTH = 2000;

export function scrubMessage(message: string): string {
  let scrubbed = message;
  for (const [pattern, replacement] of PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }

  return scrubbed.slice(0, SCRUBBED_MAX_LENGTH);
}

/**
 * A stack with the page's origin and query strings dropped as well: frames
 * keep the bundle file and position, which is all a crash needs.
 */
export function scrubStack(stack: string): string {
  return scrubMessage(
    stack
      .replace(/(?:https?|file):\/\/[^/\s)]+/g, "")
      .replace(/\?[^\s:)]*/g, ""),
  );
}
