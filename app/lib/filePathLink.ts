/**
 * File path detection + linkification utilities.
 *
 * Used to turn path-shaped substrings in agent chat (markdown output and
 * tool-call input/result blocks) into ⌘-clickable anchors that open the
 * file in the embedded VS Code editor.
 */

// Extensions we recognize as file references. Kept deliberately tight so
// we don't match every "foo.bar" token in prose.
const EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "css",
  "scss",
  "html",
  "md",
  "mdx",
  "yml",
  "yaml",
  "toml",
  "swift",
  "m",
  "mm",
  "h",
  "c",
  "cpp",
  "rs",
  "go",
  "py",
  "rb",
  "sh",
  "zsh",
  "bash",
  "sql",
  "xml",
  "plist",
  "lock",
  "env",
  "gitignore",
  "dockerfile",
  "pbxproj",
];

const EXT_PATTERN = EXTENSIONS.join("|");

// Matches:
//   • absolute path:  /foo/bar/baz.ts[:12[:3]]
//   • relative path containing a slash and ending with a known ext: foo/bar.ts[:12[:3]]
//   • bare filename with a known ext: package.json[:5]
// Avoids URLs (handled by the preceding (?<![/:@\\w-]) negative lookbehind), IDs,
// and matches up to a reasonable boundary.
const PATH_CORE = `(?:\\/|\\.\\.?\\/|~\\/)?[\\w.\\-/@]*[\\w\\-]\\.(?:${EXT_PATTERN})`;
const LINE_COL = `(?::(\\d+))?(?::\\d+)?`;

export const FILE_PATH_REGEX = new RegExp(
  `(?<![\\w/@-])(${PATH_CORE})${LINE_COL}(?![\\w])`,
  "gi",
);

export interface FileRef {
  line?: number;
  path: string;
}

/** Split a matched `path` or `path:line` / `path:line:col` token. */
export function parseFileRef(raw: string): FileRef {
  const m = raw.match(/^(.*?)(?::(\d+))?(?::\d+)?$/);
  if (!m) {
    return { path: raw };
  }

  return {
    path: m[1],
    line: m[2] ? Number(m[2]) : undefined,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

function wrapLink(
  path: string,
  line: number | undefined,
  label: string,
): string {
  const lineAttr = line ? ` data-file-line="${line}"` : "";

  return `<a class="file-link" data-file-path="${escapeAttr(path)}"${lineAttr}>${escapeHtml(label)}</a>`;
}

/**
 * Walk HTML text nodes and wrap file-like tokens in <a class="file-link">.
 *
 * Uses a naive tokenizer that skips over tag content and inner content of
 * <a>, <code>, and <pre> elements is fair game (marked-rendered code spans
 * are just styled text — CMD-click should still work there).
 */
export function linkifyFilePaths(html: string): string {
  let result = "";
  let i = 0;
  // Skip state: inside an <a> tag we don't want nested anchors.
  let insideAnchor = 0;

  while (i < html.length) {
    const ch = html[i];

    if (ch === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) {
        result += html.slice(i);
        break;
      }
      const tag = html.slice(i, end + 1);
      result += tag;
      if (/^<a\b/i.test(tag)) {
        insideAnchor++;
      } else if (/^<\/a\s*>/i.test(tag)) {
        insideAnchor = Math.max(0, insideAnchor - 1);
      }
      i = end + 1;
      continue;
    }

    // Accumulate a text run until the next tag.
    const next = html.indexOf("<", i);
    const run = next === -1 ? html.slice(i) : html.slice(i, next);

    if (insideAnchor > 0) {
      result += run;
    } else {
      result += linkifyTextRun(run);
    }

    i = next === -1 ? html.length : next;
  }

  return result;
}

function linkifyTextRun(text: string): string {
  // The text here is already HTML-escaped (marked escapes < > & for us).
  // Run the regex against the escaped form — our pattern doesn't include
  // those chars so it's safe.
  return text.replace(
    FILE_PATH_REGEX,
    (match, corePath: string, lineStr?: string) => {
      const line = lineStr ? Number(lineStr) : undefined;

      return wrapLink(corePath, line, match);
    },
  );
}

/**
 * Split plain text into segments suitable for rendering in JSX. Each
 * segment is either a literal string or a file-link descriptor.
 * Used by tool-call <pre> blocks where we render from raw text, not HTML.
 */
export type LinkSegment =
  | { label: string; line?: number; path: string; type: "link" }
  | { type: "text"; value: string };

export function splitTextForLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let lastIndex = 0;
  // `replace` with a regex that has the `g` flag would also work; using
  // matchAll keeps indices accessible cleanly.
  for (const match of text.matchAll(FILE_PATH_REGEX)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    const full = match[0];
    const corePath = match[1];
    const line = match[2] ? Number(match[2]) : undefined;
    segments.push({ type: "link", label: full, path: corePath, line });
    lastIndex = start + full.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}
