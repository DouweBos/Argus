/**
 * Glob-driven release notes for a session worktree.
 *
 * An alternative to (and superset of) the `@changesets/cli` workflow for
 * projects that maintain release notes as plain text or structured files.
 * The user lists glob patterns in `.argus.json#release_note_patterns`; we
 * surface every file matching those patterns that was added or modified
 * on this branch versus its base, with the file's content rendered inline
 * and any configured labels (regex / JSON / YAML / XML / changesets
 * frontmatter) extracted as Badges.
 *
 * If the project doesn't configure any patterns but ships a
 * `.changeset/config.json` (or `.js`), we synthesize a sensible default
 * pointing at `.changeset/*.md` with `format: "changesets"` so existing
 * `@changesets/cli` users keep the same UX with no migration.
 */

import type {
  ReleaseNoteFormat,
  ReleaseNoteLabelConfig,
  ReleaseNoteLabelTone,
  ReleaseNotePatternConfig,
} from "./models";
import fg from "fast-glob";
import { XMLParser } from "fast-xml-parser";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { appState } from "../../state";
import { loadArgusConfig } from "./argusConfig";
import { git } from "./git";

export interface ReleaseNoteLabel {
  name: string;
  value: string;
  tone?: ReleaseNoteLabelTone;
}

export interface ReleaseNoteEntry {
  /** Path relative to the repo root, e.g. `.changeset/silly-cats-dance.md`. */
  filename: string;
  /** Format used to parse this entry — surfaces to the renderer so it
   * can show format-specific affordances (e.g. "Validate with agent"). */
  format: ReleaseNoteFormat;
  /** Full text content of the file as it lives on this branch (trimmed,
   * minus changeset YAML frontmatter when format is "changesets"). */
  content: string;
  /** "added" if the file is new on this branch, "modified" if it existed at the merge-base. */
  status: "added" | "modified";
  /** Labels extracted via the matching pattern's `labels` config. */
  labels: ReleaseNoteLabel[];
}

export interface SessionReleaseNotesResult {
  entries: ReleaseNoteEntry[];
  patterns: ReleaseNotePatternConfig[];
  usesReleaseNotes: boolean;
}

/**
 * Return the matching release-note files for a session.
 *
 * Returns `usesReleaseNotes: false` when neither `release_note_patterns`
 * is configured nor a `.changeset/config.*` is present. Otherwise lists
 * every file matching one of the patterns that was added or modified on
 * this branch versus its base, sorted by path.
 */
export async function getSessionReleaseNotes(
  id: string,
): Promise<SessionReleaseNotesResult> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  // Pending sessions (still initializing) have no worktree on disk yet.
  if (!ws.path) {
    return { entries: [], patterns: [], usesReleaseNotes: false };
  }

  let patterns: ReleaseNotePatternConfig[] = [];
  try {
    const config = loadArgusConfig(ws.repo_root);
    patterns = config.release_note_patterns ?? [];
  } catch {
    // Malformed config — surface as "not using release notes" rather than
    // throwing through to the renderer.
    return { entries: [], patterns: [], usesReleaseNotes: false };
  }

  // Auto-default for projects that already use @changesets/cli but
  // haven't migrated to release_note_patterns yet — keeps the home-screen
  // experience unchanged with zero config.
  if (patterns.length === 0 && hasChangesetsConfig(ws.path)) {
    patterns = [{ glob: ".changeset/*.md", format: "changesets", labels: [] }];
  }

  if (patterns.length === 0) {
    return { entries: [], patterns: [], usesReleaseNotes: false };
  }

  if (!ws.base_branch) {
    return { entries: [], patterns, usesReleaseNotes: true };
  }

  let mergeBase: string;
  try {
    mergeBase = (
      await git(ws.path, ["merge-base", ws.base_branch, "HEAD"])
    ).trim();
  } catch {
    return { entries: [], patterns, usesReleaseNotes: true };
  }
  if (!mergeBase) {
    return { entries: [], patterns, usesReleaseNotes: true };
  }

  // Use a git pathspec with `:(glob)` magic so the configured globs are
  // applied natively (`**` works, `*` doesn't cross `/`). Limiting to
  // `--diff-filter=AM` skips files deleted on this branch — those have no
  // current content to display.
  //
  // Note: the diff is `<merge-base>` (no `..HEAD` / `...HEAD`), so it
  // compares the merge-base to the **working tree** — picking up not just
  // committed work but also staged and unstaged edits. `pnpm changeset`
  // (and most release-notes workflows) creates the file then immediately
  // stages it without committing, so a `...HEAD` range would miss the
  // very file the user wants to see in the home-screen card.
  const pathspecs = patterns.map((p) => `:(glob)${p.glob}`);
  const matchesByPath = new Map<string, "added" | "modified">();
  try {
    const diffOutput = await git(ws.path, [
      "diff",
      "--name-status",
      "--diff-filter=AM",
      mergeBase,
      "--",
      ...pathspecs,
    ]);
    for (const line of diffOutput.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      // Format: `<status>\t<path>` — `A` for added, `M` for modified.
      const tab = trimmed.indexOf("\t");
      if (tab === -1) {
        continue;
      }
      const code = trimmed.slice(0, tab).trim();
      const filename = trimmed.slice(tab + 1).trim();
      if (!filename) {
        continue;
      }
      matchesByPath.set(filename, code.startsWith("A") ? "added" : "modified");
    }
  } catch {
    return { entries: [], patterns, usesReleaseNotes: true };
  }

  // `git diff <commit>` doesn't surface untracked files — fold them in via
  // `ls-files --others` so a brand-new release note that hasn't been
  // `git add`-ed yet still appears.
  try {
    const untrackedOutput = await git(ws.path, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ...pathspecs,
    ]);
    for (const line of untrackedOutput.split("\n")) {
      const filename = line.trim();
      if (filename && !matchesByPath.has(filename)) {
        matchesByPath.set(filename, "added");
      }
    }
  } catch {
    // Untracked enumeration is best-effort.
  }

  const matches = Array.from(matchesByPath, ([filename, status]) => ({
    filename,
    status,
  })).sort((a, b) => a.filename.localeCompare(b.filename));

  // Read the file content from the worktree (the agent's current view —
  // matches what would actually ship on merge). Files that were renamed or
  // disappeared between the diff and the read are skipped.
  const fsPromises = await import("node:fs/promises");
  const entries: ReleaseNoteEntry[] = [];
  for (const m of matches) {
    let raw: string;
    try {
      raw = await fsPromises.readFile(path.join(ws.path, m.filename), "utf8");
    } catch {
      continue;
    }
    const pattern = pickPattern(m.filename, patterns);
    if (!pattern) {
      continue;
    }
    // Skip changesets README (every @changesets/cli scaffold ships it,
    // and it's not a release note).
    if (
      pattern.format === "changesets" &&
      path.basename(m.filename).toLowerCase() === "readme.md"
    ) {
      continue;
    }

    const { content, labels } = extractContentAndLabels(raw, pattern);
    entries.push({
      filename: m.filename,
      format: pattern.format,
      content,
      status: m.status,
      labels,
    });
  }

  return { entries, patterns, usesReleaseNotes: true };
}

/**
 * Dry-run preview used by the project-settings dialog: glob the repo root
 * directly (no git diff, no merge-base), apply each pattern's parser to
 * the matched files, and return the would-be `ReleaseNoteEntry` list as
 * if every match had been freshly added on this branch. Lets the dialog
 * render the resulting card next to the editor so the user can verify
 * their globs/labels are correct without committing anything.
 */
export async function previewReleaseNotes(
  repoRoot: string,
  patterns: ReleaseNotePatternConfig[],
): Promise<{ entries: ReleaseNoteEntry[] }> {
  if (!repoRoot || patterns.length === 0) {
    return { entries: [] };
  }

  // Resolve every pattern's matches in parallel; tag each file with the
  // pattern that produced it so we keep first-pattern-wins precedence
  // identical to `getSessionReleaseNotes`.
  const matchedByPath = new Map<string, ReleaseNotePatternConfig>();
  for (const pattern of patterns) {
    let matches: string[];
    try {
      matches = await fg(pattern.glob, {
        cwd: repoRoot,
        dot: true,
        onlyFiles: true,
        ignore: ["**/.git/**"],
      });
    } catch {
      continue;
    }
    for (const rel of matches) {
      if (matchedByPath.has(rel)) {
        continue;
      }
      if (
        pattern.format === "changesets" &&
        path.basename(rel).toLowerCase() === "readme.md"
      ) {
        continue;
      }
      matchedByPath.set(rel, pattern);
    }
  }

  const sortedPaths = Array.from(matchedByPath.keys()).sort();
  const fsPromises = await import("node:fs/promises");
  const entries: ReleaseNoteEntry[] = [];
  for (const rel of sortedPaths) {
    const pattern = matchedByPath.get(rel);
    if (!pattern) {
      continue;
    }
    let raw: string;
    try {
      raw = await fsPromises.readFile(path.join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    const { content, labels } = extractContentAndLabels(raw, pattern);
    entries.push({
      filename: rel,
      format: pattern.format,
      content,
      status: "added",
      labels,
    });
  }

  return { entries };
}

/** Return true when the worktree contains a `@changesets/cli` config. */
function hasChangesetsConfig(worktreePath: string): boolean {
  return (
    fs.existsSync(path.join(worktreePath, ".changeset", "config.json")) ||
    fs.existsSync(path.join(worktreePath, ".changeset", "config.js"))
  );
}

/**
 * Pick the first configured pattern whose glob would match `filename`. Used
 * to look up the format/labels for a file we already know is a release note
 * (it appeared in the git-pathspec-restricted diff output). When multiple
 * patterns match, the first one wins — same precedence as the diff command.
 */
function pickPattern(
  filename: string,
  patterns: ReleaseNotePatternConfig[],
): ReleaseNotePatternConfig | null {
  for (const p of patterns) {
    if (matchesGlob(filename, p.glob)) {
      return p;
    }
  }

  // The file is in the diff but doesn't appear to match any of our globs —
  // fall back to the first configured pattern so labels at least get tried.
  return patterns[0] ?? null;
}

/**
 * Match a path against a single glob pattern using the same `:(glob)`
 * semantics git uses: `*` doesn't cross `/`, `**` does. Implemented as a
 * regex translation so we don't pull in another matcher dependency.
 */
function matchesGlob(filepath: string, pattern: string): boolean {
  const re = globToRegex(pattern);

  return re.test(filepath);
}

function globToRegex(pattern: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` or `**` — match any number of path segments (including zero).
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      re += "[^/]";
      i += 1;
    } else if (".+()|^$[]{}\\".includes(ch)) {
      re += `\\${ch}`;
      i += 1;
    } else {
      re += ch;
      i += 1;
    }
  }
  re += "$";

  return new RegExp(re);
}

/**
 * Strip and parse the content for an entry, returning the visible text
 * plus any extracted labels. For "changesets" format the YAML frontmatter
 * is consumed (each `pkg: bump` becomes a label) and the body is the
 * content. For other formats the full file text is shown.
 */
function extractContentAndLabels(
  raw: string,
  pattern: ReleaseNotePatternConfig,
): { content: string; labels: ReleaseNoteLabel[] } {
  if (pattern.format === "changesets") {
    return extractChangesetContentAndLabels(raw);
  }
  const labels: ReleaseNoteLabel[] = [];
  if (pattern.labels.length > 0) {
    const parsed = parseForLabels(raw, pattern.format);
    for (const label of pattern.labels) {
      const value = extractOne(raw, parsed, pattern.format, label);
      if (value != null && value !== "") {
        labels.push(
          label.tone
            ? { name: label.name, value, tone: label.tone }
            : { name: label.name, value },
        );
      }
    }
  }

  return { content: raw.trim(), labels };
}

/**
 * Parse a `@changesets/cli` markdown file: YAML frontmatter between `---`
 * fences declares `"<package>": <bump>` entries, followed by a free-form
 * body. Each frontmatter entry becomes a Badge label tone-mapped from the
 * bump severity (major→warning, minor→accent, patch→success).
 */
function extractChangesetContentAndLabels(raw: string): {
  content: string;
  labels: ReleaseNoteLabel[];
} {
  const fenced = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fenced) {
    return { content: raw.trim(), labels: [] };
  }
  const [, front, body] = fenced;
  const labels: ReleaseNoteLabel[] = [];
  for (const line of front.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const m = trimmed.match(/^["']?([^"':]+?)["']?\s*:\s*["']?([^"']+?)["']?$/);
    if (!m) {
      continue;
    }
    const name = m[1].trim();
    const bump = m[2].trim();
    labels.push({ name, value: bump, tone: bumpTone(bump) });
  }

  return { content: body.trim(), labels };
}

function bumpTone(bump: string): ReleaseNoteLabelTone {
  const b = bump.toLowerCase();
  if (b === "major") {
    return "warning";
  }
  if (b === "minor") {
    return "accent";
  }

  return "success";
}

/**
 * Pre-parse the raw text once per file according to the configured format.
 * Regex format reads the raw string directly so no parse step is needed.
 * Returns `null` on parse failure — labels then resolve to empty.
 */
function parseForLabels(
  raw: string,
  format: ReleaseNoteFormat,
): unknown | null {
  if (format === "regex" || format === "changesets") {
    return null;
  }
  try {
    if (format === "json") {
      return JSON.parse(raw);
    }
    if (format === "yaml") {
      return YAML.parse(raw);
    }
    if (format === "xml") {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@",
        textNodeName: "#text",
      });

      return parser.parse(raw);
    }
  } catch {
    return null;
  }

  return null;
}

function extractOne(
  raw: string,
  parsed: unknown,
  format: ReleaseNoteFormat,
  label: ReleaseNoteLabelConfig,
): string | null {
  if (format === "regex") {
    let re: RegExp;
    try {
      re = new RegExp(label.selector, "mi");
    } catch {
      return null;
    }
    const match = raw.match(re);
    if (!match) {
      return null;
    }

    return (match[1] ?? match[0]).trim();
  }

  if (parsed == null) {
    return null;
  }

  return resolveDottedPath(parsed, label.selector);
}

/**
 * Walk a dotted path into a parsed JSON/YAML/XML object. Numeric segments
 * index into arrays; everything else is a property lookup. Returns the
 * stringified leaf value, or `null` if any segment can't be resolved.
 *
 * Arrays/objects at the leaf are joined with ", " so a YAML
 * `platforms: [iOS, Android]` field renders as a single badge.
 */
function resolveDottedPath(root: unknown, selector: string): string | null {
  let cursor: unknown = root;
  for (const segment of selector.split(".")) {
    if (cursor == null || typeof cursor !== "object") {
      return null;
    }
    if (Array.isArray(cursor) && /^\d+$/.test(segment)) {
      cursor = cursor[Number(segment)];
    } else {
      cursor = (cursor as Record<string, unknown>)[segment];
    }
  }
  if (cursor == null) {
    return null;
  }
  if (Array.isArray(cursor)) {
    return cursor
      .map((v) => (v == null ? "" : String(v)))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof cursor === "object") {
    return null;
  }

  return String(cursor).trim();
}
