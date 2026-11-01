/**
 * What the quick open field asks for: VS Code's prefixes (`@` symbols in the
 * file, `#` symbols in the workspace, `:` a line) on top of the palette's own
 * mode. The TS twin of ArgusCore's `QuickOpenQuery`.
 */

/**
 * `mixed` is files and workspace symbols together (Open Quickly); `@:` lists
 * file symbols grouped by kind; a line is null until a number is typed, and
 * both it and the column are 1-based.
 */
export type QuickOpenQuery =
  | { column: number | null; kind: "line"; line: number | null }
  | { grouped: boolean; kind: "fileSymbols"; text: string }
  | { kind: "files"; text: string }
  | { kind: "mixed"; text: string }
  | { kind: "workspaceSymbols"; text: string };

/** What text without a prefix means. */
export type QuickOpenBase = "files" | "mixed";

function positive(raw: string | undefined): number | null {
  const trimmed = raw?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const n = Number(trimmed);

  return n > 0 ? n : null;
}

export function parseQuickOpenQuery(
  text: string,
  base: QuickOpenBase,
): QuickOpenQuery {
  const rest = text.slice(1);
  switch (text.charAt(0)) {
    case "":
      return { kind: base, text: "" };
    case "@":
      return rest.startsWith(":")
        ? { kind: "fileSymbols", text: rest.slice(1).trim(), grouped: true }
        : { kind: "fileSymbols", text: rest.trim(), grouped: false };
    case "#":
      return { kind: "workspaceSymbols", text: rest.trim() };
    case ":": {
      const parts = rest.split(/[:,]/).filter((p) => p.length > 0);
      const line = positive(parts[0]);
      const column = line === null ? null : positive(parts[1]);

      return { kind: "line", line, column };
    }
    default:
      return { kind: base, text };
  }
}
