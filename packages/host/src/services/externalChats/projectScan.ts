/**
 * Projects behind the Claude Code CLI's chat history: every transcript under
 * `~/.claude/projects`, grouped by the directory it ran in.
 */

import type {
  CliProjectImportSource,
  CliProjectScan as RemoteCliProjectScan,
} from "@argus/remote-protocol";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";
import { appState } from "../../state";
import { addRepoRoot } from "../session/manager";
import { capture } from "../telemetry/telemetry";
import { bucket } from "./importer";

/** Newest transcripts considered; past this the result says it was truncated. */
export const MAX_TRANSCRIPTS = 5000;
/** Bytes read from a transcript's head while looking for its `cwd`. */
const HEAD_BYTES = 256 * 1024;

export interface CliProjectCandidate {
  path: string;
  chatCount: number;
  /** Unix ms of the newest transcript. */
  lastActiveAt: number;
}

export interface CliProjectScan {
  candidates: CliProjectCandidate[];
  truncated: boolean;
}

async function readCwd(file: string): Promise<string | null> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(file, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    for (const line of buf.toString("utf8", 0, bytesRead).split("\n")) {
      const at = line.indexOf('"cwd":"');
      if (at < 0) {
        continue;
      }
      try {
        const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd;
        if (typeof cwd === "string" && cwd) {
          return cwd;
        }
      } catch {
        // A line cut off at the read boundary.
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/** A linked worktree's `.git` is a file pointing into another repo's `worktrees/`. */
function isLinkedWorktree(dir: string): boolean {
  try {
    const dotGit = path.join(dir, ".git");
    if (!fs.statSync(dotGit).isFile()) {
      return false;
    }

    return /gitdir:.*[/\\]worktrees[/\\]/.test(fs.readFileSync(dotGit, "utf8"));
  } catch {
    return false;
  }
}

function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);

  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Directories that were never projects: home, temp, Argus's own worktrees. */
/** Home, temp and Argus's own dirs: never offered as projects. */
export function excludedRoots(): string[] {
  const tmp = os.tmpdir();
  let realTmp = tmp;
  try {
    realTmp = fs.realpathSync(tmp);
  } catch {
    // Keep the unresolved path.
  }

  return [
    tmp,
    realTmp,
    "/tmp",
    "/private/tmp",
    argusHomeDir(),
    path.join(os.homedir(), "Downloads"),
  ];
}

export function isProjectCandidate(
  dir: string,
  excluded: string[] = excludedRoots(),
): boolean {
  if (dir === os.homedir() || dir === path.parse(dir).root) {
    return false;
  }
  if (excluded.some((root) => isUnder(dir, root))) {
    return false;
  }
  if (
    dir.includes(`${path.sep}.argus${path.sep}`) ||
    dir.includes("-argus-worktrees")
  ) {
    return false;
  }
  try {
    if (
      !fs.statSync(dir).isDirectory() ||
      !fs.existsSync(path.join(dir, ".git"))
    ) {
      return false;
    }
  } catch {
    return false;
  }

  return !isLinkedWorktree(dir);
}

export async function scanCliProjects(
  root = path.join(os.homedir(), ".claude", "projects"),
  excluded: string[] = excludedRoots(),
): Promise<CliProjectScan> {
  const transcripts: { file: string; mtimeMs: number }[] = [];
  let dirs: fs.Dirent[] = [];
  try {
    dirs = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return { candidates: [], truncated: false };
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) {
      continue;
    }
    const full = path.join(root, dir.name);
    let files: string[] = [];
    try {
      files = (await fs.promises.readdir(full)).filter((f) =>
        f.endsWith(".jsonl"),
      );
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const { mtimeMs } = await fs.promises.stat(path.join(full, f));
        transcripts.push({ file: path.join(full, f), mtimeMs });
      } catch {
        // Deleted mid-scan.
      }
    }
  }
  transcripts.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const truncated = transcripts.length > MAX_TRANSCRIPTS;
  const byCwd = new Map<string, CliProjectCandidate>();
  for (const t of transcripts.slice(0, MAX_TRANSCRIPTS)) {
    const cwd = await readCwd(t.file);
    if (!cwd) {
      continue;
    }
    const key = path.resolve(cwd);
    const entry = byCwd.get(key);
    if (entry) {
      entry.chatCount += 1;
      entry.lastActiveAt = Math.max(entry.lastActiveAt, t.mtimeMs);
    } else {
      byCwd.set(key, { path: key, chatCount: 1, lastActiveAt: t.mtimeMs });
    }
  }
  const candidates = [...byCwd.values()]
    .filter((c) => isProjectCandidate(c.path, excluded))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  return { candidates, truncated };
}

/** The scan, shaped for clients, with this host's projects marked. */
export async function scanCliProjectsForClients(
  source: CliProjectImportSource = "dialog",
): Promise<RemoteCliProjectScan> {
  const scan = await scanCliProjects();
  capture("cli_projects_scanned", {
    source,
    candidate_bucket: bucket(scan.candidates.length),
    truncated: scan.truncated,
  });

  return {
    truncated: scan.truncated,
    candidates: scan.candidates.map((c) => ({
      path: c.path,
      name: path.basename(c.path),
      chat_count: c.chatCount,
      last_active_at: c.lastActiveAt,
      added: appState.repoRoots.has(c.path),
    })),
  };
}

/** Register picked directories; anything no longer a git repo is skipped. */
export function importCliProjects(
  paths: string[],
  source: CliProjectImportSource = "dialog",
): { added: number } {
  let added = 0;
  for (const dir of new Set(paths.map((p) => path.resolve(p)))) {
    if (appState.repoRoots.has(dir) || !isProjectCandidate(dir)) {
      continue;
    }
    addRepoRoot(dir);
    added += 1;
  }
  capture("cli_projects_imported", { count: added, source });

  return { added };
}
