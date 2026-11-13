/**
 * "Viewed" marks on a session's diff, kept at `~/.argus/viewed-files.json` for
 * branches without a pull request to hold them. Each mark remembers the file's
 * content when it was ticked; once that changes the mark reads as `changed`.
 */

import type { ViewedFile } from "../github/viewedFiles";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { appState } from "../../state";
import { capture } from "../telemetry/telemetry";

export type ViewedDiffMode = "branch" | "working";

/** session id → diff mode → path → content fingerprint. */
type Marks = Record<
  string,
  Partial<Record<ViewedDiffMode, Record<string, string>>>
>;

let cache: Marks | null = null;

function storePath(): string {
  return path.join(argusHomeDir(), "viewed-files.json");
}

function load(): Marks {
  if (cache) {
    return cache;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as {
      sessions?: Marks;
    };
    cache = parsed.sessions ?? {};
  } catch {
    cache = {};
  }

  return cache;
}

function save(all: Marks): void {
  // Marks of deleted sessions go with them.
  const marks = Object.fromEntries(
    Object.entries(all).filter(([id]) => appState.sessions.has(id)),
  );
  cache = marks;
  const file = storePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      `${file}.tmp`,
      JSON.stringify({ version: 1, sessions: marks }),
    );
    fs.renameSync(`${file}.tmp`, file);
  } catch (e) {
    warn("viewed-files", "save failed", e);
  }
}

function worktree(sessionId: string): string {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `Session not found: ${sessionId}`;
  }

  return session.path;
}

/** Hashes the worktree's copy without following links out of it. */
async function fingerprint(root: string, relPath: string): Promise<string> {
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw `Path is outside the session: ${relPath}`;
  }
  const hash = createHash("sha1");
  try {
    const stat = await fs.promises.lstat(abs);
    if (stat.isSymbolicLink()) {
      hash.update(`link:${await fs.promises.readlink(abs)}`);
    } else if (stat.isFile()) {
      hash.update(await fs.promises.readFile(abs));
    } else {
      hash.update(`kind:${stat.mode}`);
    }
  } catch {
    hash.update("missing");
  }

  return hash.digest("hex");
}

export async function getSessionViewedFiles(
  sessionId: string,
  mode: ViewedDiffMode,
): Promise<ViewedFile[]> {
  const root = worktree(sessionId);
  const marks = load()[sessionId]?.[mode] ?? {};

  return Promise.all(
    Object.entries(marks).map(async ([file, mark]) => ({
      path: file,
      state:
        (await fingerprint(root, file)) === mark
          ? ("viewed" as const)
          : ("changed" as const),
    })),
  );
}

export async function setSessionFileViewed(params: {
  mode: ViewedDiffMode;
  path: string;
  sessionId: string;
  viewed: boolean;
}): Promise<void> {
  const root = worktree(params.sessionId);
  const marks = load();
  const session = (marks[params.sessionId] ??= {});
  const kept = Object.entries(session[params.mode] ?? {}).filter(
    ([file]) => file !== params.path,
  );
  if (params.viewed) {
    kept.push([params.path, await fingerprint(root, params.path)]);
  }
  session[params.mode] = Object.fromEntries(kept);
  save(marks);
  capture("diff_file_viewed", { source: "session", viewed: params.viewed });
}

/** For tests: forget what was read from disk. */
export function resetViewedFilesCache(): void {
  cache = null;
}
