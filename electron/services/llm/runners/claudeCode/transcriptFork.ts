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

/** Slug rule used by the Claude Code CLI for `~/.claude/projects/<slug>/`. */
function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
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
