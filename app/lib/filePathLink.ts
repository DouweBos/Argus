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
  | { label: string; type: "url"; url: string }
  | { type: "text"; value: string };

// http(s) URL matcher. Stops before whitespace or trailing punctuation that is
// usually sentence punctuation rather than part of the URL.
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
const URL_TRAILING = /[.,;:!?)\]}>'"]+$/;

/**
 * Split plain text on `@mention` tokens (user-typed file references from the
 * chat input). A mention is `@` followed by non-whitespace, preceded by start
 * of input or whitespace. Backslash-escaped whitespace (e.g. `path\ name`,
 * as produced by drag-dropping a path with spaces from Finder) is treated as
 * part of the token. Trailing punctuation (`.,;:!?)`]`) is excluded so
 * `@foo/bar.ts.` links only `@foo/bar.ts`.
 */
const MENTION_REGEX = /(^|\s)@((?:\\\s|\S)+)/g;
const MENTION_TRAILING = /[.,;:!?)\]}>'"]+$/;

/** Unescape shell-style backslash escapes (e.g. `\ ` → ` `) in a path. */
function unescapeShellPath(path: string): string {
  return path.replace(/\\(\s)/g, "$1");
}

/**
 * Strip trailing punctuation matching `pattern`, but keep paired closers
 * (`)`, `]`, `}`) when their opener appears earlier in the token. This makes
 * `path/to/dir (3)` link the whole `(3)` rather than chopping off the `)`.
 */
function trimTrailingPunctuation(token: string, pattern: RegExp): string {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  while (token.length > 0) {
    const last = token[token.length - 1];
    if (!pattern.test(last)) {
      break;
    }
    const opener = pairs[last];
    if (opener) {
      const inner = token.slice(0, -1);
      const opens = (inner.match(new RegExp(`\\${opener}`, "g")) ?? []).length;
      const closes = (inner.match(new RegExp(`\\${last}`, "g")) ?? []).length;
      if (opens > closes) {
        break;
      }
    }
    token = token.slice(0, -1);
  }

  return token;
}

export function splitTextForMentions(text: string): LinkSegment[] {
  // Callers hand us block text typed as `string`, but renderers can pass
  // undefined/empty for blocks with no text — guard so one bad block doesn't
  // white-screen the whole chat.
  if (!text) {
    return [];
  }
  interface Marker {
    end: number;
    segment: Extract<LinkSegment, { type: "link" | "url" }>;
    start: number;
  }

  const markers: Marker[] = [];

  for (const match of text.matchAll(MENTION_REGEX)) {
    const start = match.index ?? 0;
    const leading = match[1];
    let token = match[2];
    token = trimTrailingPunctuation(token, MENTION_TRAILING);
    if (!token) {
      continue;
    }
    const mentionStart = start + leading.length;
    const ref = parseFileRef(token);
    markers.push({
      start: mentionStart,
      end: mentionStart + 1 + token.length,
      segment: {
        type: "link",
        label: `@${token}`,
        path: unescapeShellPath(ref.path),
        line: ref.line,
      },
    });
  }

  for (const range of findUrlRanges(text)) {
    markers.push({
      start: range.start,
      end: range.end,
      segment: { type: "url", url: range.url, label: range.url },
    });
  }

  markers.sort((a, b) => a.start - b.start);

  const segments: LinkSegment[] = [];
  let cursor = 0;
  for (const m of markers) {
    if (m.start < cursor) {
      continue;
    }
    if (m.start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, m.start) });
    }
    segments.push(m.segment);
    cursor = m.end;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}

interface UrlRange {
  end: number;
  start: number;
  url: string;
}

function findUrlRanges(text: string): UrlRange[] {
  const ranges: UrlRange[] = [];
  if (!text) {
    return ranges;
  }
  for (const match of text.matchAll(URL_REGEX)) {
    const start = match.index ?? 0;
    let url = match[0];
    url = trimTrailingPunctuation(url, URL_TRAILING);
    if (!url) {
      continue;
    }
    ranges.push({ start, end: start + url.length, url });
  }

  return ranges;
}

export function splitTextForLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  if (!text) {
    return segments;
  }
  const urlRanges = findUrlRanges(text);
  let cursor = 0;

  const emitFilePathsIn = (slice: string) => {
    let last = 0;
    for (const match of slice.matchAll(FILE_PATH_REGEX)) {
      const start = match.index ?? 0;
      if (start > last) {
        segments.push({ type: "text", value: slice.slice(last, start) });
      }
      const full = match[0];
      const corePath = match[1];
      const line = match[2] ? Number(match[2]) : undefined;
      segments.push({ type: "link", label: full, path: corePath, line });
      last = start + full.length;
    }
    if (last < slice.length) {
      segments.push({ type: "text", value: slice.slice(last) });
    }
  };

  for (const range of urlRanges) {
    if (range.start > cursor) {
      emitFilePathsIn(text.slice(cursor, range.start));
    }
    segments.push({ type: "url", url: range.url, label: range.url });
    cursor = range.end;
  }
  if (cursor < text.length) {
    emitFilePathsIn(text.slice(cursor));
  }

  return segments;
}
