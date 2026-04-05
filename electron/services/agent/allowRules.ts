/**
 * Session-level allow-rule parsing, matching, and glob utilities.
 *
 * Extracted from `permissions.ts` for reuse by {@link ControlHandler}.
 * These are pure functions with no runtime side-effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A parsed allow rule like `Bash(npm *)` or `Edit(**\/*.tsx)`. */
export interface AllowRule {
  /** Tool name, e.g. `Bash`, `Edit`, `Write`. */
  tool: string;
  /**
   * Optional glob pattern over the tool-specific specifier.
   * `null` means "match all uses of this tool".
   */
  specifier: string | null;
}

// ---------------------------------------------------------------------------
// Rule parsing
// ---------------------------------------------------------------------------

/**
 * Parse a rule string like `Bash(npm *)` or `Edit(**\/*.tsx)` into an
 * {@link AllowRule}.
 */
export function parseAllowRule(ruleStr: string): AllowRule {
  const openParen = ruleStr.indexOf("(");
  if (openParen !== -1) {
    const tool = ruleStr.slice(0, openParen);
    // Strip trailing ')' from specifier.
    const specifier = ruleStr.slice(openParen + 1).replace(/\)$/, "");
    return { tool, specifier };
  }
  // Bare tool name — matches all uses.
  return { tool: ruleStr, specifier: null };
}

// ---------------------------------------------------------------------------
// Specifier extraction
// ---------------------------------------------------------------------------

/**
 * Extract the specifier string from a permission request's tool input.
 *
 * Produces the value that the rule's glob pattern is matched against:
 * - Bash       -> the full command string
 * - Edit/Write/Read -> the file path
 * - WebFetch   -> `domain:<hostname>`
 */
export function extractSpecifier(
  toolName: string,
  toolInput: Record<string, unknown> | null | undefined,
): string | null {
  if (!toolInput) return null;

  switch (toolName) {
    case "Bash": {
      const cmd = toolInput["command"];
      return typeof cmd === "string" ? cmd : null;
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read": {
      const fp = toolInput["file_path"] ?? toolInput["path"];
      return typeof fp === "string" ? fp : null;
    }
    case "WebFetch": {
      const url = toolInput["url"];
      if (typeof url !== "string") return null;
      const afterScheme = url.includes("://")
        ? url.slice(url.indexOf("://") + 3)
        : url;
      const host = afterScheme.split("/")[0]?.split(":")[0] ?? "";
      return host ? `domain:${host}` : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

/**
 * Minimal glob matcher supporting `*` (any chars except `/`) and `**` (any
 * chars including `/`), plus `?` (single non-`/` char).
 *
 * Used instead of an external `minimatch` dependency so the electron bundle
 * stays lean.
 */
export function globMatch(pattern: string, value: string): boolean {
  // Build a regex from the glob pattern.
  let regexStr = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**` matches any sequence of characters including path separators.
        regexStr += ".*";
        i += 2;
        // Consume an optional following `/`.
        if (pattern[i] === "/") i++;
      } else {
        // `*` matches any sequence of characters except `/`.
        regexStr += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else {
      // Escape all other regex-special characters.
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  regexStr += "$";

  try {
    return new RegExp(regexStr).test(value);
  } catch {
    // Fallback to simple string includes for malformed patterns.
    return value.includes(pattern);
  }
}
