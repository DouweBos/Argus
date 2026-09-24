/**
 * Structured diagnostics the Claude Code CLI writes to stderr.
 *
 * They arrive as `[claude-code:<code>] {json}` and are notices, not failures —
 * a real failure surfaces as a stream error or a non-zero exit. Pointing a
 * runner at a gateway reliably trips a few of them (an unknown model id, a
 * non-first-party base URL), so they get warning styling and their payload is
 * spelled out as labelled fields rather than dumped as raw JSON.
 */

export interface CliDiagnostic {
  /** Machine code, e.g. `unrecognized_model`. */
  code: string;
  /** One `Label: value` line per payload field. */
  details: string[];
  /** Humanized headline derived from the code. */
  title: string;
}

const DIAGNOSTIC_RE = /^\[claude-code:([a-z0-9_]+)\]\s*(.*)$/is;

/** Parse a stderr line, or null when it isn't a structured diagnostic. */
export function parseCliDiagnostic(line: string): CliDiagnostic | null {
  const match = DIAGNOSTIC_RE.exec(line.trim());
  if (!match) {
    return null;
  }
  const [, code, rest] = match;

  return {
    code: code!,
    title: humanize(code!),
    details: describePayload(rest?.trim() ?? ""),
  };
}

/** `unrecognized_model` → `Unrecognized model`. */
function humanize(token: string): string {
  const words = token.replace(/_/g, " ").trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Spell the payload out as `Label: value` lines. Anything that isn't a flat
 * JSON object is kept as the single line it already was.
 */
function describePayload(rest: string): string[] {
  if (!rest) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rest);
  } catch {
    return [rest];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [rest];
  }

  return Object.entries(parsed as Record<string, unknown>).map(
    ([key, value]) =>
      `${humanize(key)}: ${
        typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : String(value)
      }`,
  );
}
