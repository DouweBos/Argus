/** One labelled value from a tool's input. */
export interface ToolInputField {
  /** Human-readable path: `file_path`, `edits 1 · old_string`. */
  label: string;
  /** Worth its own block rather than a line: code, prose, anything wrapped. */
  isLong: boolean;
  value: string;
}

/** Past this a value gets its own block instead of sitting on the label's line. */
const LONG_VALUE_CHARS = 48;

/** A leaf, and the empty containers that have nothing to descend into. */
function scalar(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "none";
}

function append(label: string, value: unknown, out: ToolInputField[]): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ label, value: "none", isLong: false });

      return;
    }
    value.forEach((item, i) => append(`${label} ${i + 1}`, item, out));

    return;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>).sort();
    if (entries.length === 0) {
      out.push({ label, value: "none", isLong: false });

      return;
    }
    for (const key of entries) {
      append(`${label} · ${key}`, (value as Record<string, unknown>)[key], out);
    }

    return;
  }
  const text = scalar(value);
  out.push({
    label,
    value: text,
    isLong: text.length > LONG_VALUE_CHARS || text.includes("\n"),
  });
}

/**
 * Flatten a tool's input into labelled values.
 *
 * Braces and quotes carry nothing — which field and what is in it is the whole
 * story, so even a tool nobody wrote a view for reads as a list rather than as
 * a wall of JSON.
 */
export function toolInputFields(
  input: Record<string, unknown>,
): ToolInputField[] {
  const out: ToolInputField[] = [];
  for (const key of Object.keys(input).sort()) {
    append(key, input[key], out);
  }

  return out;
}

/** The same fields as plain text, for copying. */
export function toolInputText(input: Record<string, unknown>): string {
  return toolInputFields(input)
    .map((f) => `${f.label}: ${f.value}`)
    .join("\n");
}
