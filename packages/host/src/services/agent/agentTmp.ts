/**
 * A temp directory per agent, handed to Claude Code as `CLAUDE_CODE_TMPDIR`
 * so its scratchpad and tool output land somewhere Argus can delete. Left in
 * the shared `/tmp/claude-<uid>`, they piled up for good.
 */

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { appState } from "../../state";

/** Keyed by `ARGUS_HOME` too, so a dev build's sweep never touches the release's agents. */
export function agentTmpRoot(): string {
  const home = createHash("sha256").update(argusHomeDir()).digest("hex").slice(0, 8);
  const uid = process.getuid?.() ?? os.userInfo().uid;

  return path.join("/tmp", `argus-${uid}-${home}`);
}

export function agentTmpDir(agentId: string): string {
  // An id is a UUID; anything else must not reach a path we later delete.
  if (!/^[\w-]+$/.test(agentId)) {
    throw new Error(`bad agent id for a temp dir: ${agentId}`);
  }

  return path.join(agentTmpRoot(), agentId);
}

export function ensureAgentTmpDir(agentId: string): string {
  const dir = agentTmpDir(agentId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  return dir;
}

export async function removeAgentTmpDir(agentId: string): Promise<void> {
  try {
    await rm(agentTmpDir(agentId), { recursive: true, force: true });
  } catch (e) {
    warn(`[agent:${agentId}] failed to remove its temp dir: ${String(e)}`);
  }
}

/** At startup no agent survives from the last run, so every directory left is an orphan. */
export async function sweepAgentTmpDirs(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(agentTmpRoot());
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((id) => !appState.agents.has(id))
      .map((id) => removeAgentTmpDir(id)),
  );
}
