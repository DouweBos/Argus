/**
 * Fork a Claude Code session JSONL transcript into a new project directory.
 *
 * Extracted from `electron/services/session/manager.ts` so the Claude Code
 * runner owns its own transcript-handling logic.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { truncateClaudeJsonl } from "../../../session/truncateClaudeJsonl";

/** Past this the CLI cuts a project dir's name short and adds a hash of the cwd. */
const MAX_SLUG = 200;

/** The Claude Code CLI's dir for a cwd's transcripts, `~/.claude/projects/<slug>/`. */
export function claudeProjectSlug(cwd: string): string {
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  if (slug.length <= MAX_SLUG) {
    return slug;
  }
  // The CLI's own 32-bit string hash, so both name the same dir.
  let hash = 0;
  for (let i = 0; i < cwd.length; i++) {
    hash = (hash << 5) - hash + cwd.charCodeAt(i);
    hash |= 0;
  }

  return `${slug.slice(0, MAX_SLUG)}-${Math.abs(hash).toString(36)}`;
}

/**
 * Copy a Claude Code session JSONL into a new project directory, truncated at
 * the Nth user turn (inclusive) and rewritten so `sessionId` / `cwd` /
 * `gitBranch` all reflect the fork.
 *
 * We count "real" user turns by looking for user-role entries whose content
 * starts with a text block — tool_result entries are encoded as user-role in
 * JSONL but belong to the prior turn and must NOT trigger the cutoff.
 */
export async function forkClaudeSessionFile(args: {
  destBranch: string;
  destCwd: string;
  forkTimestampMs: number;
  forkTurnNumber: number;
  sourceCwd: string;
  sourceSessionId: string;
}): Promise<string | null> {
  const {
    destBranch,
    destCwd,
    forkTimestampMs,
    forkTurnNumber,
    sourceCwd,
    sourceSessionId,
  } = args;

  const srcFile = path.join(
    os.homedir(),
    ".claude",
    "projects",
    claudeProjectSlug(sourceCwd),
    `${sourceSessionId}.jsonl`,
  );
  if (!fs.existsSync(srcFile)) {
    return null;
  }

  const destDir = path.join(
    os.homedir(),
    ".claude",
    "projects",
    claudeProjectSlug(destCwd),
  );
  fs.mkdirSync(destDir, { recursive: true });

  const newSessionId = crypto.randomUUID();
  const destFile = path.join(destDir, `${newSessionId}.jsonl`);

  const raw = fs.readFileSync(srcFile, "utf8");
  const kept = truncateClaudeJsonl({
    destBranch,
    destCwd,
    forkTimestampMs,
    forkTurnNumber,
    newSessionId,
    raw,
  });

  if (!kept) {
    return null;
  }

  fs.writeFileSync(destFile, kept.join("\n") + "\n", "utf8");

  return newSessionId;
}

/**
 * The session id of the newest transcript the CLI wrote for a cwd, or null
 * when it has never run there. This is what `--resume` takes to pick a
 * finished conversation back up.
 */
export function latestClaudeSessionId(cwd: string): string | null {
  const dir = path.join(
    os.homedir(),
    ".claude",
    "projects",
    claudeProjectSlug(cwd),
  );

  let newest: { id: string; mtimeMs: number } | null = null;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    try {
      const { mtimeMs } = fs.statSync(path.join(dir, name));
      if (!newest || mtimeMs > newest.mtimeMs) {
        newest = { id: name.slice(0, -".jsonl".length), mtimeMs };
      }
    } catch {
      // Raced with a delete; the other files still stand.
    }
  }

  return newest?.id ?? null;
}

/**
 * `--resume` only finds a transcript under its cwd's project dir. A chat
 * started elsewhere (the repo root, another app) is copied in, keeping its id.
 */
export function ensureClaudeTranscriptAt(cwd: string, sessionId: string): void {
  const dest = transcriptPath(cwd, sessionId);
  if (fs.existsSync(dest)) {
    return;
  }
  const src = findClaudeTranscript(cwd, sessionId);
  if (src) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function transcriptPath(cwd: string, sessionId: string): string {
  return path.join(
    os.homedir(),
    ".claude",
    "projects",
    claudeProjectSlug(cwd),
    `${sessionId}.jsonl`,
  );
}

/**
 * A conversation's transcript: the one under its cwd, else the newest. An
 * older Argus left stale copies of a long cwd's in a dir the CLI never reads.
 */
export function findClaudeTranscript(
  cwd: string,
  sessionId: string,
): string | null {
  const here = transcriptPath(cwd, sessionId);
  if (fs.existsSync(here)) {
    return here;
  }
  const root = path.join(os.homedir(), ".claude", "projects");
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return null;
  }
  let newest: { file: string; mtimeMs: number } | null = null;
  for (const dir of dirs) {
    const file = path.join(root, dir, `${sessionId}.jsonl`);
    if (!fs.existsSync(file)) {
      continue;
    }
    const { mtimeMs } = fs.statSync(file);
    if (!newest || mtimeMs > newest.mtimeMs) {
      newest = { file, mtimeMs };
    }
  }

  return newest?.file ?? null;
}
