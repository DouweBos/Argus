/**
 * Changesets detection for a session worktree.
 *
 * A project is considered to use @changesets/cli when `.changeset/config.json`
 * (or `.changeset/config.js`) exists. When present, every `*.md` file in the
 * `.changeset/` directory — except `README.md` — represents a pending release
 * note that would ship the next time `changeset version` is run.
 *
 * We surface these on the session home screen so the user can review what
 * release notes they are about to merge.
 */

import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";
import { git } from "./git";

export interface ChangesetEntry {
  /** File name within `.changeset/`, e.g. `silly-cats-dance.md`. */
  filename: string;
  /** Packages + bump types declared in the frontmatter. */
  packages: { bump: string; name: string }[];
  /** Body of the changeset (release note text), trimmed. */
  summary: string;
}

export interface SessionChangesetsResult {
  changesets: ChangesetEntry[];
  usesChangesets: boolean;
}

/**
 * Return the changesets state for a session.
 *
 * Returns `usesChangesets: false` (with an empty list) when the project has no
 * `.changeset/config.*` file. Otherwise lists every pending changeset in the
 * session worktree, sorted by filename.
 */
export async function getSessionChangesets(
  id: string,
): Promise<SessionChangesetsResult> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  const changesetDir = path.join(ws.path, ".changeset");
  const hasConfig =
    fs.existsSync(path.join(changesetDir, "config.json")) ||
    fs.existsSync(path.join(changesetDir, "config.js"));

  if (!hasConfig) {
    return { changesets: [], usesChangesets: false };
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(changesetDir);
  } catch {
    return { changesets: [], usesChangesets: true };
  }

  const mdFiles = entries
    .filter(
      (name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md",
    )
    .sort();

  // Restrict to changesets that only exist on this session's branch. Files that
  // were already on the base branch at the merge-base don't belong to this
  // session's work and would be released independently.
  const baseline = await listChangesetFilesOnBase(ws.path, ws.base_branch);
  const ownFiles = baseline
    ? mdFiles.filter((name) => !baseline.has(name))
    : mdFiles;

  const changesets: ChangesetEntry[] = [];
  for (const filename of ownFiles) {
    const full = path.join(changesetDir, filename);
    let raw: string;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    changesets.push(parseChangeset(filename, raw));
  }

  return { changesets, usesChangesets: true };
}

/**
 * List `.changeset/*.md` file names that existed at the merge-base of the
 * session branch and its base. Returns `null` when the baseline can't be
 * determined (no base branch, no common ancestor) — in that case callers
 * should treat every changeset as session-owned.
 */
async function listChangesetFilesOnBase(
  wsPath: string,
  baseBranch: string | null | undefined,
): Promise<Set<string> | null> {
  if (!baseBranch) {
    return null;
  }
  let mergeBase: string;
  try {
    mergeBase = (await git(wsPath, ["merge-base", baseBranch, "HEAD"])).trim();
  } catch {
    return null;
  }
  if (!mergeBase) {
    return null;
  }

  let raw: string;
  try {
    raw = await git(wsPath, [
      "ls-tree",
      "-r",
      "--name-only",
      mergeBase,
      "--",
      ".changeset",
    ]);
  } catch {
    // No `.changeset/` directory at the merge-base — every pending changeset
    // is session-owned.
    return new Set();
  }

  const baseline = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.endsWith(".md")) {
      continue;
    }
    baseline.add(path.basename(trimmed));
  }

  return baseline;
}

/**
 * Parse a single changeset file: YAML frontmatter between `---` fences
 * declaring `"package-name": bump` entries, followed by a free-form body.
 */
export function parseChangeset(filename: string, raw: string): ChangesetEntry {
  const packages: { bump: string; name: string }[] = [];
  let summary = raw.trim();

  const fenced = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fenced) {
    const [, front, body] = fenced;
    summary = body.trim();
    for (const line of front.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      // Match: "pkg-name": patch   or   pkg-name: minor
      const m = trimmed.match(
        /^["']?([^"':]+?)["']?\s*:\s*["']?([^"']+?)["']?$/,
      );
      if (m) {
        packages.push({ bump: m[2].trim(), name: m[1].trim() });
      }
    }
  }

  return { filename, packages, summary };
}
