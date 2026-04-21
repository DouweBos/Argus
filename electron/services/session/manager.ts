/**
 * Session lifecycle management: create, delete, list git worktrees.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { error, info } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import {
  generateBranchAndTitle,
  generateSessionTitle,
  humanizeBranchName,
} from "../llm/titleGenerator";
import { orgHostDir } from "../organizationTask/paths";
import { createTerminal } from "../terminal/multiplexer";
import {
  applyBranchPrefix,
  loadUserProjectSettings,
} from "../userProjectSettings/store";
import {
  branchToDir,
  git,
  repairOrphanedWorktrees,
  titleToBranchSlug,
  worktreesRoot,
} from "./git";
import {
  getMeta,
  isValidWorktree,
  loadMetadata,
  migrateOrphaned,
  saveMetadata,
  type SessionMeta,
} from "./metadata";
import { defaultArgusConfig, type Session, type SessionStatus } from "./models";
import { loadArgusConfig, runSetupPipeline } from "./setup";
import { startBranchWatcher } from "./watcher";

// ---------------------------------------------------------------------------
// add_repo_root / remove_repo_root
// ---------------------------------------------------------------------------

/** Add a repository root to the set of open projects. */
export function addRepoRoot(dirPath: string): void {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw `Path is not a directory: ${dirPath}`;
  }
  info(`Adding repo root: ${dirPath}`);
  appState.repoRoots.add(dirPath);
}

/** Remove a repository root from the set of open projects. */
export function removeRepoRoot(dirPath: string): void {
  appState.repoRoots.delete(dirPath);

  // Find session IDs belonging to this repo root.
  const wsIds: string[] = [];
  for (const ws of appState.sessions.values()) {
    if (ws.repo_root === dirPath) {
      wsIds.push(ws.id);
    }
  }

  // Kill agents for those sessions.
  for (const [key, session] of appState.agents.entries()) {
    if (wsIds.includes(session.sessionId)) {
      try {
        session.child.kill();
      } catch (e) {
        info(`removeRepoRoot: kill agent ${key} returned:`, e);
      }
      appState.agents.delete(key);
    }
  }

  // Kill terminal sessions associated with these sessions.
  for (const wsId of wsIds) {
    for (const key of appState.terminals.keys()) {
      if (key.includes(wsId)) {
        const session = appState.terminals.get(key);
        if (session) {
          try {
            session.pty.kill();
          } catch {
            // Ignore
          }
        }
        appState.terminals.delete(key);
      }
    }
  }

  // Stop file watchers.
  for (const wsId of wsIds) {
    const handle = appState.watchers.get(wsId);
    if (handle) {
      handle.stop();
      appState.watchers.delete(wsId);
    }
  }

  // Remove sessions from state.
  for (const wsId of wsIds) {
    appState.sessions.delete(wsId);
  }

  info(`Removed repo root and ${wsIds.length} sessions: ${dirPath}`);
}

// ---------------------------------------------------------------------------
// list_sessions
// ---------------------------------------------------------------------------

/**
 * Return all managed sessions for the given repo root.
 *
 * Merges live in-memory state (descriptions, statuses, display names) with the
 * worktrees discovered on disk via `git worktree list`. Persisted metadata is
 * loaded and migrated to remove orphaned entries.
 */
export async function listSessions(repoRoot: string): Promise<Session[]> {
  const worktreesDir = worktreesRoot(repoRoot);
  const diskSessions = await listWorktrees(repoRoot);

  // Load persisted metadata and migrate away orphaned entries.
  const rawMeta = loadMetadata(worktreesDir);
  const [meta] = migrateOrphaned(worktreesDir, rawMeta);

  // Remove from in-memory state any sessions whose paths no longer exist on
  // disk. We only drop a session if the directory is genuinely gone — if git
  // is mid-operation (e.g. a rebase that briefly makes a worktree invisible),
  // `livePaths` may not contain it even though the directory still exists. In
  // that case we keep the in-memory entry and re-merge it below as a synthetic
  // disk entry so it survives the refresh.
  const livePaths = new Set(diskSessions.map((w) => w.path));
  for (const [id, ws] of [...appState.sessions.entries()]) {
    if (
      ws.repo_root === repoRoot &&
      ws.kind !== "project_root" &&
      !livePaths.has(ws.path)
    ) {
      if (isValidWorktree(ws.path)) {
        diskSessions.push({ ...ws });
        livePaths.add(ws.path);
      } else {
        appState.sessions.delete(id);
      }
    }
  }

  // Merge: for each worktree on disk, apply persisted metadata and in-memory state.
  const merged: Session[] = diskSessions.map((ws) => {
    // Apply in-memory state first.
    const existing = [...appState.sessions.values()].find(
      (w) => w.path === ws.path,
    );
    if (existing) {
      ws.id = existing.id;
      ws.description = existing.description;
      ws.status = existing.status;
      ws.display_name = existing.display_name;
    }

    // Persisted metadata overwrites (it survives restarts).
    const m = getMeta(meta, ws.path);
    if (m) {
      ws.id = m.id;
      ws.display_name = m.display_name;
      ws.description = m.description;
      ws.base_branch = m.base_branch;
      ws.organization_task_id = m.organization_task_id ?? null;
    }

    if (!appState.sessions.has(ws.id)) {
      appState.sessions.set(ws.id, { ...ws });
    }

    return ws;
  });

  // Persist metadata for all live worktrees.
  const metaToSave = new Map<string, SessionMeta>();
  for (const w of merged) {
    if (w.kind === "worktree") {
      metaToSave.set(w.path, {
        id: w.id,
        display_name: w.display_name,
        description: w.description,
        base_branch: w.base_branch,
        organization_task_id: w.organization_task_id ?? null,
      });
    }
  }
  try {
    saveMetadata(worktreesDir, metaToSave);
  } catch {
    // Non-fatal
  }

  // Include repo-root sessions (not discovered via git worktree list).
  for (const ws of appState.sessions.values()) {
    if (ws.kind === "project_root" && ws.repo_root === repoRoot) {
      try {
        ws.branch = (
          await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
        ).trim();
        appState.sessions.set(ws.id, ws);
      } catch {
        // Keep existing branch name on failure.
      }
      merged.push({ ...ws });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// create_session
// ---------------------------------------------------------------------------

/**
 * Create a new session (git worktree + branch) and run the setup pipeline.
 *
 * Returns immediately with the session in `initializing` status. The setup
 * pipeline runs asynchronously in the background, emitting
 * `session:status:{id}` when complete.
 */
export async function createSession(
  repoRoot: string,
  branch: string,
  description: string,
  useExistingBranch?: boolean,
  explicitBaseBranch?: string,
): Promise<Session> {
  // Apply the developer's personal required branch prefix (if configured) to
  // new branches. Existing branches are adopted as-is.
  //
  // If the caller supplied an empty branch (new-session flow where the user
  // didn't type one), ask claude -p to generate a branch name + title from
  // the prompt. On failure, fall back to slugging the description directly.
  let branchInput = branch;
  let preGeneratedTitle: string | null = null;
  if (useExistingBranch !== true) {
    if (!branch.trim() && description.trim()) {
      const generated = await generateBranchAndTitle(description, repoRoot);
      if (generated) {
        branchInput = generated.branch;
        preGeneratedTitle = generated.title;
      } else {
        branchInput = description;
      }
    }
    const prefix = loadUserProjectSettings(repoRoot).branch_prefix ?? "";
    branchInput = applyBranchPrefix(branchInput, prefix);
  }

  // Enforce one-session-per-branch: a given branch in a given repo may only be
  // claimed by a single worktree-kind session.
  const branchSlug =
    useExistingBranch === true ? branchInput : titleToBranchSlug(branchInput);
  for (const existing of appState.sessions.values()) {
    if (
      existing.kind === "worktree" &&
      existing.repo_root === repoRoot &&
      existing.branch === branchSlug
    ) {
      const label = existing.display_name ?? existing.branch;
      throw `Branch "${branchSlug}" is already used by session "${label}". Each branch can only be used by one session.`;
    }
  }

  // Use the explicit base branch if provided (e.g. when creating a child
  // worktree from another worktree), otherwise fall back to the repo root HEAD.
  let baseBranch: string | undefined = explicitBaseBranch;
  if (!baseBranch) {
    try {
      baseBranch = (
        await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
      ).trim();
    } catch {
      baseBranch = undefined;
    }
  }

  let session: Session;
  if (useExistingBranch === true) {
    session = await createWorktreeFromExisting(
      repoRoot,
      branchInput,
      description,
      baseBranch,
    );
  } else {
    session = await createWorktree(
      repoRoot,
      branchInput,
      description,
      baseBranch,
    );
  }

  // Assign sequential env_index.
  const nextIndex = [...appState.sessions.values()].filter(
    (w) => w.kind !== "project_root",
  ).length;
  session.env_index = nextIndex;

  // Set a humanized placeholder title so the row renders something readable
  // before the LLM-generated title comes back. If claude -p already produced
  // a nice title as part of branch generation, use that directly.
  if (preGeneratedTitle) {
    session.display_name = preGeneratedTitle;
  } else if (
    !session.display_name ||
    session.display_name === branch ||
    session.display_name === branchInput
  ) {
    session.display_name = humanizeBranchName(session.branch);
  }
  appState.sessions.set(session.id, { ...session });

  // Persist display name and base_branch so it survives app restarts.
  const worktreesDir = worktreesRoot(repoRoot);
  const meta = loadMetadata(worktreesDir);
  meta.set(session.path, {
    id: session.id,
    display_name: session.display_name,
    description: session.description,
    base_branch: session.base_branch,
  });
  try {
    saveMetadata(worktreesDir, meta);
  } catch {
    // Non-fatal
  }

  // Fire-and-forget: ask Claude for a nicer title. On success, update state,
  // persist, and notify the renderer so the row re-renders. Skipped when
  // branch+title was pre-generated above (we already have a good title).
  const titleSessionId = session.id;
  const titleSessionPath = session.path;
  if (!preGeneratedTitle) {
    generateSessionTitle({
      branch: session.branch,
      description: session.description,
      repoRoot,
    })
      .then((title) => {
        if (!title) {
          return;
        }
        const ws = appState.sessions.get(titleSessionId);
        if (!ws) {
          return;
        }
        ws.display_name = title;
        appState.sessions.set(titleSessionId, ws);

        try {
          const metaNow = loadMetadata(worktreesDir);
          const entry = metaNow.get(titleSessionPath) ?? {
            id: ws.id,
            description: ws.description,
            base_branch: ws.base_branch,
          };
          metaNow.set(titleSessionPath, { ...entry, display_name: title });
          saveMetadata(worktreesDir, metaNow);
        } catch {
          // Non-fatal
        }

        getMainWindow()?.webContents.send("session:updated", {
          id: titleSessionId,
          display_name: title,
        });
      })
      .catch((e: unknown) => {
        info(`Title generation skipped for session ${titleSessionId}:`, e);
      });
  }

  const config = loadArgusConfig(repoRoot) ?? defaultArgusConfig();
  const taskSessionId = session.id;
  const taskSessionPath = session.path;

  // Spawn the setup PTY up-front so its id can be returned in the session
  // response — this lets the renderer attach a Setup tab synchronously,
  // avoiding a race against the fire-and-forget pipeline below. Non-fatal on
  // failure: the pipeline will still run (using a freshly-spawned pty).
  let setupTerminalId: string | null = null;
  try {
    setupTerminalId = createTerminal(taskSessionId);
  } catch (e) {
    info(
      `Could not pre-spawn setup terminal for ${taskSessionId}: ${String(e)}`,
    );
  }
  session.setup_terminal_id = setupTerminalId;
  if (setupTerminalId) {
    const stored = appState.sessions.get(taskSessionId);
    if (stored) {
      stored.setup_terminal_id = setupTerminalId;
      appState.sessions.set(taskSessionId, stored);
    }
  }

  info(
    `Spawning setup pipeline for session ${taskSessionId} (path=${taskSessionPath})`,
  );

  // Run setup pipeline in background (no await — returns immediately).
  runSetupPipeline(
    repoRoot,
    taskSessionPath,
    config,
    taskSessionId,
    setupTerminalId,
  )
    .then(() => {
      const finalStatus: SessionStatus = "ready";
      const ws = appState.sessions.get(taskSessionId);
      if (ws) {
        ws.status = finalStatus;
        appState.sessions.set(taskSessionId, ws);
      }
      getMainWindow()?.webContents.send(
        `session:status:${taskSessionId}`,
        "ready",
      );
    })
    .catch((e: unknown) => {
      const errMsg = typeof e === "string" ? e : String(e);
      error(`Setup pipeline failed for session ${taskSessionId}: ${errMsg}`);
      const finalStatus: SessionStatus = { error: errMsg };
      const ws = appState.sessions.get(taskSessionId);
      if (ws) {
        ws.status = finalStatus;
        appState.sessions.set(taskSessionId, ws);
      }
      getMainWindow()?.webContents.send(
        `session:status:${taskSessionId}`,
        `error:${errMsg}`,
      );
    });

  return session;
}

// ---------------------------------------------------------------------------
// fork_session
// ---------------------------------------------------------------------------

export type ForkReplayOp =
  | {
      content: string;
      filePath: string;
      timestampMs: number;
      type: "write";
    }
  | {
      edits: { newString: string; oldString: string; replaceAll?: boolean }[];
      filePath: string;
      timestampMs: number;
      type: "multiEdit";
    }
  | {
      filePath: string;
      newString: string;
      oldString: string;
      replaceAll?: boolean;
      timestampMs: number;
      type: "edit";
    };

export interface ForkSessionResult {
  /** New Claude CLI session id for `--resume` (null when no source JSONL was truncated). */
  claude_session_id: string | null;
  session: Session;
}

/**
 * Fork an existing worktree session into a new worktree *as it was at a
 * specific message*.
 *
 * - The new worktree checks out the newest commit on the source branch whose
 *   committer time is at or before `forkTimestampMs`. Anything committed
 *   after the fork point is intentionally excluded. Uncommitted changes are
 *   never carried over — we cannot reliably reconstruct the working tree's
 *   state at an arbitrary past message, so we only fork from immutable
 *   commit points.
 * - If `sourceClaudeSessionId` is provided, the source session's Claude Code
 *   JSONL is copied into the new worktree's Claude project directory,
 *   truncated at the fork turn, and rewritten with a fresh sessionId/cwd/
 *   branch so the forked agent can `--resume` into a real continuation of
 *   the prior conversation.
 *
 * The source session is left completely untouched.
 */
export async function forkSession(
  sourceSessionId: string,
  newBranch: string,
  description: string,
  forkTimestampMs: number,
  forkTurnNumber: number,
  sourceClaudeSessionId?: string | null,
  replayOps?: ForkReplayOp[] | null,
): Promise<ForkSessionResult> {
  const source = appState.sessions.get(sourceSessionId);
  if (!source) {
    throw `Session not found: ${sourceSessionId}`;
  }
  if (source.kind !== "worktree" && source.kind !== "project_root") {
    throw `Cannot fork a session of kind "${source.kind}"`;
  }
  const srcPath = source.path;
  const srcBranch = source.branch;
  const repoRoot = source.repo_root;

  // Find the most recent commit on the source branch at or before the fork
  // message's timestamp. `git rev-list --before` is inclusive of the given
  // instant. Fall back to the branch's root commit if nothing predates the
  // fork point (e.g. the fork message is older than any commit on the branch).
  const cutoffIso = new Date(forkTimestampMs).toISOString();
  let forkCommit = "";
  try {
    forkCommit = (
      await git(srcPath, [
        "rev-list",
        "-n",
        "1",
        `--before=${cutoffIso}`,
        srcBranch,
      ])
    ).trim();
  } catch {
    forkCommit = "";
  }
  if (!forkCommit) {
    try {
      forkCommit = (
        await git(srcPath, ["rev-list", "--max-parents=0", srcBranch])
      )
        .trim()
        .split("\n")[0];
    } catch {
      forkCommit = "";
    }
  }

  const session = await createSession(
    repoRoot,
    newBranch,
    description,
    false,
    srcBranch,
  );

  if (forkCommit) {
    try {
      await git(session.path, ["reset", "--hard", forkCommit]);
    } catch (e) {
      info(`forkSession: reset to fork commit failed: ${String(e)}`);
    }
  }

  // Replay Edit/Write/MultiEdit tool calls between the fork commit and the
  // fork message to reconstruct uncommitted working-tree state.
  if (replayOps && replayOps.length > 0) {
    let commitTimeMs = 0;
    if (forkCommit) {
      try {
        const ct = (
          await git(session.path, ["show", "-s", "--format=%ct", forkCommit])
        ).trim();
        const secs = Number.parseInt(ct, 10);
        if (!Number.isNaN(secs)) {
          commitTimeMs = secs * 1000;
        }
      } catch {
        commitTimeMs = 0;
      }
    }
    applyReplayOps(
      replayOps,
      srcPath,
      session.path,
      commitTimeMs,
      forkTimestampMs,
    );
  }

  let newClaudeSessionId: string | null = null;
  if (sourceClaudeSessionId) {
    try {
      newClaudeSessionId = await forkClaudeSessionFile({
        sourceCwd: srcPath,
        sourceSessionId: sourceClaudeSessionId,
        destCwd: session.path,
        destBranch: session.branch,
        forkTimestampMs,
        forkTurnNumber,
      });
    } catch (e) {
      info(`forkSession: JSONL truncation failed: ${String(e)}`);
      newClaudeSessionId = null;
    }
  }

  info(
    `Forked session ${sourceSessionId} → ${session.id} (branch ${session.branch}, commit ${forkCommit || "<none>"}, claude ${newClaudeSessionId ?? "<none>"})`,
  );

  return { session, claude_session_id: newClaudeSessionId };
}

/**
 * Rebase a file path captured against the source worktree onto the new
 * worktree. Leaves paths pointing outside the source worktree untouched —
 * those are filtered out by the caller.
 */
function rebaseForkPath(
  p: string,
  srcCwd: string,
  destCwd: string,
): string | null {
  const src = srcCwd.replace(/\/+$/, "");
  const dest = destCwd.replace(/\/+$/, "");
  if (p === src) {
    return dest;
  }
  if (p.startsWith(src + "/")) {
    return dest + p.slice(src.length);
  }

  return null;
}

function applyEditString(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  if (replaceAll) {
    return content.split(oldString).join(newString);
  }
  const idx = content.indexOf(oldString);
  if (idx < 0) {
    // No match — nothing to apply. The post-commit state may already reflect
    // this edit (idempotent replay), or it predates a later overwrite.
    return content;
  }

  return (
    content.slice(0, idx) + newString + content.slice(idx + oldString.length)
  );
}

/**
 * Replay Edit/Write/MultiEdit tool calls against the new worktree. We skip
 * anything whose timestamp falls outside (commitTimeMs, forkTimestampMs] —
 * earlier ops are captured by the commit we just reset to, later ops would
 * cross the fork boundary.
 */
function applyReplayOps(
  ops: ForkReplayOp[],
  srcCwd: string,
  destCwd: string,
  commitTimeMs: number,
  forkTimestampMs: number,
): void {
  for (const op of ops) {
    if (op.timestampMs <= commitTimeMs || op.timestampMs > forkTimestampMs) {
      continue;
    }
    const target = rebaseForkPath(op.filePath, srcCwd, destCwd);
    if (!target) {
      continue;
    }
    try {
      if (op.type === "write") {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, op.content, "utf8");
      } else if (op.type === "edit") {
        let current = "";
        try {
          current = fs.readFileSync(target, "utf8");
        } catch {
          // File may not exist yet if the commit predates its creation — treat
          // as empty and let the edit either materialise it or no-op.
          current = "";
        }
        const updated = applyEditString(
          current,
          op.oldString,
          op.newString,
          op.replaceAll === true,
        );
        if (updated !== current) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, updated, "utf8");
        }
      } else if (op.type === "multiEdit") {
        let current = "";
        try {
          current = fs.readFileSync(target, "utf8");
        } catch {
          current = "";
        }
        let next = current;
        for (const e of op.edits) {
          next = applyEditString(
            next,
            e.oldString,
            e.newString,
            e.replaceAll === true,
          );
        }
        if (next !== current) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, next, "utf8");
        }
      }
    } catch (e) {
      info(`forkSession: replay op on ${op.filePath} failed: ${String(e)}`);
    }
  }
}

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
async function forkClaudeSessionFile(args: {
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
  const lines = raw.split("\n");
  const kept: string[] = [];

  let userTurnsSeen = 0;
  let afterCutoff = false;
  const cutoffMs = forkTimestampMs;
  // Small buffer: frontend timestamps are set at event-receipt time and may
  // lead the JSONL timestamp by a few hundred ms. 2s is more than enough.
  const buffer = 2000;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = parsed.type;
    const isRealUser =
      type === "user" &&
      (() => {
        const message = parsed.message as { content?: unknown } | undefined;
        const content = Array.isArray(message?.content)
          ? (message.content as unknown[])
          : [];
        const first = content[0] as { type?: string } | undefined;

        return first?.type === "text";
      })();

    if (isRealUser) {
      userTurnsSeen += 1;
      if (userTurnsSeen > forkTurnNumber) {
        break;
      }
    }

    // Timestamp safety-net: once we've passed the cutoff and we're between
    // turns, stop. Keeps us from including events that trail the fork turn
    // when the turn counter alone can't tell.
    const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : null;
    if (ts) {
      const entryMs = Date.parse(ts);
      if (!Number.isNaN(entryMs) && entryMs > cutoffMs + buffer) {
        if (userTurnsSeen >= forkTurnNumber) {
          afterCutoff = true;
        }
      }
    }
    if (afterCutoff && isRealUser) {
      break;
    }

    // Rewrite identity fields so the new JSONL stands alone as a resumable
    // session tied to the forked worktree.
    if ("sessionId" in parsed) {
      parsed.sessionId = newSessionId;
    }
    if ("cwd" in parsed) {
      parsed.cwd = destCwd;
    }
    if ("gitBranch" in parsed) {
      parsed.gitBranch = destBranch;
    }

    kept.push(JSON.stringify(parsed));
  }

  if (kept.length === 0) {
    return null;
  }

  fs.writeFileSync(destFile, kept.join("\n") + "\n", "utf8");

  return newSessionId;
}

// ---------------------------------------------------------------------------
// create_org_host_session
// ---------------------------------------------------------------------------

/**
 * Create a neutral "org host" session for a cross-repo OrgTask.
 *
 * Unlike worktree sessions, this session is not tied to any git repo —
 * it's a plain directory at `~/.argus/org-hosts/{orgId}/{taskId}/` where a
 * single agent runs with access to every scope repo via MCP tools.
 *
 * No git operations, no setup pipeline, no file watchers. Returns the
 * session in `ready` status.
 */
export async function createOrgHostSession(options: {
  organizationId: string;
  taskId: string;
  displayName: string;
}): Promise<Session> {
  const dir = orgHostDir(options.organizationId, options.taskId);
  fs.mkdirSync(dir, { recursive: true });

  const ws: Session = {
    id: crypto.randomUUID(),
    kind: "org_host",
    branch: "",
    display_name: options.displayName,
    description: "",
    path: dir,
    repo_root: dir,
    status: "ready",
    env_index: null,
    base_branch: null,
    organization_task_id: null,
  };

  appState.sessions.set(ws.id, ws);
  getMainWindow()?.webContents.send("session:created", { ...ws });
  info(`Created org-host session ${ws.id} at ${dir}`);

  return { ...ws };
}

// ---------------------------------------------------------------------------
// create_project_root_session
// ---------------------------------------------------------------------------

/**
 * Create (or return existing) repo-root session that runs on HEAD.
 *
 * There can be at most one repo-root session per repo.
 */
export function createHeadSession(repoRoot: string): Session {
  // Return existing repo-root session for this repo if one exists.
  for (const ws of appState.sessions.values()) {
    if (ws.kind === "project_root" && ws.repo_root === repoRoot) {
      return { ...ws };
    }
  }

  let branch = "HEAD";
  try {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
    })
      .toString()
      .trim();
  } catch {
    // Keep "HEAD" on failure.
  }

  const ws: Session = {
    id: crypto.randomUUID(),
    kind: "project_root",
    branch,
    display_name: null,
    description: "",
    path: repoRoot,
    repo_root: repoRoot,
    status: "ready",
    env_index: null,
    base_branch: null,
  };

  appState.sessions.set(ws.id, ws);

  // Watch .git/HEAD for external branch switches.
  const branchHandle = startBranchWatcher(repoRoot, ws.id);
  appState.watchers.set(ws.id, branchHandle);

  info(`Created repo-root (HEAD) session ${ws.id}`);

  return { ...ws };
}

// ---------------------------------------------------------------------------
// delete_session
// ---------------------------------------------------------------------------

/**
 * Rename a session by setting a new display name. Persists to metadata and
 * notifies the renderer via `session:updated`.
 */
export function renameSession(id: string, displayName: string): void {
  const session = appState.sessions.get(id);
  if (!session) {
    throw `Session not found: ${id}`;
  }
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw "Display name cannot be empty";
  }

  session.display_name = trimmed;
  appState.sessions.set(id, session);

  try {
    const worktreesDir = worktreesRoot(session.repo_root);
    const meta = loadMetadata(worktreesDir);
    const existing = meta.get(session.path) ?? {
      id: session.id,
      description: session.description,
      base_branch: session.base_branch,
    };
    meta.set(session.path, { ...existing, display_name: trimmed });
    saveMetadata(worktreesDir, meta);
  } catch (e) {
    info(`renameSession: persist metadata failed for ${id}:`, e);
  }

  getMainWindow()?.webContents.send("session:updated", {
    id,
    display_name: trimmed,
  });
}

/**
 * Rename the git branch backing a worktree session. Runs `git branch -m` in
 * the worktree (which updates the ref and repoints the worktree), updates
 * in-memory state, and notifies the renderer.
 *
 * The worktree directory is intentionally left in place — git tracks the
 * worktree by path, and moving it would invalidate running terminals and the
 * agent's cwd. The path's old branch slug is cosmetic only.
 */
export async function renameSessionBranch(
  id: string,
  newBranch: string,
): Promise<void> {
  const session = appState.sessions.get(id);
  if (!session) {
    throw `Session not found: ${id}`;
  }
  if (session.kind !== "worktree") {
    throw `Cannot rename branch on a session of kind "${session.kind}"`;
  }

  const slug = titleToBranchSlug(newBranch);
  if (!slug) {
    throw "Branch name cannot be empty";
  }
  if (slug === session.branch) {
    return;
  }

  for (const other of appState.sessions.values()) {
    if (
      other.id !== id &&
      other.kind === "worktree" &&
      other.repo_root === session.repo_root &&
      other.branch === slug
    ) {
      const label = other.display_name ?? other.branch;
      throw `Branch "${slug}" is already used by session "${label}".`;
    }
  }

  await git(session.path, ["branch", "-m", session.branch, slug]);

  session.branch = slug;
  appState.sessions.set(id, session);

  getMainWindow()?.webContents.send("session:updated", {
    id,
    branch: slug,
  });
}

/**
 * Delete a session: kill its agent and terminals, remove the worktree.
 *
 * Returns immediately after cleaning up in-memory state. The actual
 * `git worktree remove` runs asynchronously. On background failure, emits
 * `session:delete-failed` with `{ id, error }`.
 */
export async function deleteSession(
  id: string,
  shouldDeleteBranch?: boolean,
): Promise<void> {
  const session = appState.sessions.get(id);
  if (!session) {
    throw `Session not found: ${id}`;
  }
  const repoRoot = session.repo_root;

  // Kill all agent sessions for this session.
  const killedAgentIds: string[] = [];
  for (const [key, agentEntry] of appState.agents.entries()) {
    if (agentEntry.sessionId === id) {
      try {
        agentEntry.child.kill();
      } catch (e) {
        info(`deleteSession: kill agent ${key} returned:`, e);
      }
      appState.agents.delete(key);
      killedAgentIds.push(key);
    }
  }

  // Kill terminal sessions associated with this session.
  for (const key of appState.terminals.keys()) {
    if (key.includes(id)) {
      const terminal = appState.terminals.get(key);
      if (terminal) {
        try {
          terminal.pty.kill();
        } catch {
          // Ignore
        }
      }
      appState.terminals.delete(key);
    }
  }

  // Stop file watcher for this session.
  const watcher = appState.watchers.get(id);
  if (watcher) {
    watcher.stop();
    appState.watchers.delete(id);
  }

  const win = getMainWindow();

  // Notify the renderer that agents were killed.
  if (win) {
    for (const agentId of killedAgentIds) {
      win.webContents.send(`agent:exit:${agentId}`, 0);
    }
  }

  if (session.kind === "project_root") {
    // Repo-root sessions don't have a worktree to remove on disk — delete
    // immediately.
    appState.sessions.delete(id);
    win?.webContents.send("session:deleted", id);
    info(`Deleted session ${id}`);

    return;
  }

  if (session.kind === "org_host") {
    // Neutral org-host session — just remove the directory.
    try {
      fs.rmSync(session.path, { force: true, recursive: true });
    } catch (e) {
      info(`deleteSession: rm org-host dir failed: ${String(e)}`);
    }
    appState.sessions.delete(id);
    win?.webContents.send("session:deleted", id);
    info(`Deleted org-host session ${id}`);

    return;
  }

  // Mark the session as "deleting" so the sidebar reflects the in-progress
  // state instead of showing stale content (e.g. a spike of reported
  // deletions from the file watcher) while the worktree is removed on disk.
  session.status = "deleting";
  appState.sessions.set(id, session);
  win?.webContents.send(`session:status:${id}`, "deleting");

  const taskRepoRoot = repoRoot;
  const taskSessionPath = session.path;
  const taskBranch = session.branch;
  const taskDeleteBranch = shouldDeleteBranch ?? false;
  const taskId = id;

  // Run the heavy work in the background.
  (async () => {
    try {
      await git(taskRepoRoot, [
        "worktree",
        "remove",
        "--force",
        taskSessionPath,
      ]);
      await git(taskRepoRoot, ["worktree", "prune"]);
    } catch (e) {
      const errMsg = typeof e === "string" ? e : String(e);
      error(`Background delete failed for session ${taskId}: ${errMsg}`);
      // Restore the session's status so the user can retry.
      const ws = appState.sessions.get(taskId);
      if (ws) {
        ws.status = { error: errMsg };
        appState.sessions.set(taskId, ws);
      }
      getMainWindow()?.webContents.send(
        `session:status:${taskId}`,
        `error:${errMsg}`,
      );
      getMainWindow()?.webContents.send("session:delete-failed", {
        id: taskId,
        error: errMsg,
      });

      return;
    }

    if (taskDeleteBranch) {
      try {
        await git(taskRepoRoot, ["branch", "-D", taskBranch]);
      } catch (e) {
        error(`Failed to delete branch '${taskBranch}':`, e);
        // Not fatal — worktree is already removed.
      }
    }

    const worktreesDir = worktreesRoot(taskRepoRoot);
    const meta = loadMetadata(worktreesDir);
    meta.delete(taskSessionPath);
    try {
      saveMetadata(worktreesDir, meta);
    } catch {
      // Non-fatal
    }

    appState.sessions.delete(taskId);
    getMainWindow()?.webContents.send("session:deleted", taskId);
    info(`Deleted session ${taskId} (background)`);
  })();
}

// ---------------------------------------------------------------------------
// Internal helpers: createWorktree / createWorktreeFromExisting
// ---------------------------------------------------------------------------

/**
 * Create a new worktree for `branch` branching from the current HEAD of the
 * main repo. Returns the new `Session` in `initializing` status.
 */
async function createWorktree(
  repoRoot: string,
  branch: string,
  description: string,
  baseBranch: string | undefined,
): Promise<Session> {
  const branchSlug = titleToBranchSlug(branch);
  const worktreesDir = worktreesRoot(repoRoot);
  const dirName = branchToDir(branchSlug);
  const worktreePath = `${worktreesDir}/${dirName}`;

  if (fs.existsSync(worktreePath)) {
    // Check if git actually knows about this worktree.
    let knownRaw = "";
    try {
      knownRaw = await git(repoRoot, ["worktree", "list", "--porcelain"]);
    } catch {
      // Ignore
    }
    const isRegistered = knownRaw
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .some((l) => l.slice("worktree ".length).trim() === worktreePath);

    if (isRegistered) {
      throw `Worktree directory already exists: ${worktreePath}`;
    }

    info(`Removing orphaned worktree directory: ${worktreePath}`);
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  fs.mkdirSync(worktreesDir, { recursive: true });

  await git(repoRoot, [
    "worktree",
    "add",
    "-b",
    branchSlug,
    worktreePath,
    baseBranch ?? "HEAD",
  ]);

  info(`Created worktree for branch '${branchSlug}' at ${worktreePath}`);

  return {
    id: crypto.randomUUID(),
    kind: "worktree",
    branch: branchSlug,
    display_name: branch,
    description,
    path: worktreePath,
    repo_root: repoRoot,
    status: "initializing",
    env_index: null,
    base_branch: baseBranch ?? null,
  };
}

/**
 * Create a worktree for an existing branch (no new branch is created).
 * Finds a unique path by appending _2, _3, etc. if needed.
 */
async function createWorktreeFromExisting(
  repoRoot: string,
  branch: string,
  description: string,
  baseBranch: string | undefined,
): Promise<Session> {
  const worktreesDir = worktreesRoot(repoRoot);
  const baseDir = branchToDir(branch);
  let worktreePath = `${worktreesDir}/${baseDir}`;
  let suffix = 2;
  while (fs.existsSync(worktreePath)) {
    worktreePath = `${worktreesDir}/${baseDir}_${suffix}`;
    suffix += 1;
  }

  fs.mkdirSync(worktreesDir, { recursive: true });

  await git(repoRoot, ["worktree", "add", worktreePath, branch]);

  info(`Created worktree for existing branch '${branch}' at ${worktreePath}`);

  return {
    id: crypto.randomUUID(),
    kind: "worktree",
    branch,
    display_name: null,
    description,
    path: worktreePath,
    repo_root: repoRoot,
    status: "initializing",
    env_index: null,
    base_branch: baseBranch ?? null,
  };
}

// ---------------------------------------------------------------------------
// Internal helper: listWorktrees
// ---------------------------------------------------------------------------

/**
 * Return all existing worktrees for `repoRoot` as `Session` values by
 * parsing `git worktree list --porcelain`.
 *
 * Worktrees in a detached-HEAD state (e.g. mid-rebase, mid-checkout) still
 * need to show up in the sidebar — otherwise an agent rebase that briefly
 * detaches HEAD makes the session vanish from the UI. When the `branch` line
 * is absent, fall back to:
 *   1. `rebase-merge/head-name` in the worktree's gitdir (populated during a
 *      rebase with the original branch's ref).
 *   2. The in-memory workspace or persisted metadata (previous known branch).
 *   3. The resolved `HEAD` symbolic ref (handles detached checkouts that still
 *      have a symbolic ref on disk).
 */
async function listWorktrees(repoRoot: string): Promise<Session[]> {
  await repairOrphanedWorktrees(repoRoot);

  const raw = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  const root = worktreesRoot(repoRoot);
  const meta = loadMetadata(worktreesRoot(repoRoot));

  const sessions: Session[] = [];
  let currentPath: string | null = null;
  let currentBranch: string | null = null;

  const lines = raw.split("\n");
  // Ensure a trailing blank line so the final block is flushed.
  if (lines[lines.length - 1] !== "") {
    lines.push("");
  }

  const flushBlock = () => {
    if (!currentPath) {
      return;
    }
    if (!currentPath.startsWith(root) || !isValidWorktree(currentPath)) {
      return;
    }
    const branch = currentBranch ?? resolveDetachedBranch(currentPath, meta);
    if (!branch) {
      return;
    }
    sessions.push({
      id: crypto.randomUUID(),
      kind: "worktree",
      branch,
      display_name: null,
      description: "",
      path: currentPath,
      repo_root: repoRoot,
      status: "ready",
      env_index: null,
      base_branch: null,
    });
  };

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length).trim();
      currentBranch = null;
    } else if (line.startsWith("branch ")) {
      currentBranch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    } else if (line.trim() === "") {
      flushBlock();
      currentPath = null;
      currentBranch = null;
    }
  }

  return sessions;
}

/**
 * Figure out the branch for a worktree that `git worktree list --porcelain`
 * reported without a `branch` line (detached HEAD — usually mid-rebase).
 */
function resolveDetachedBranch(
  worktreePath: string,
  meta: Map<string, SessionMeta>,
): string | null {
  // 1. rebase-merge/head-name records the original branch when a rebase is
  //    in progress. Format: `refs/heads/<branch>\n`.
  try {
    const gitFile = fs.readFileSync(`${worktreePath}/.git`, "utf8");
    if (gitFile.startsWith("gitdir: ")) {
      const gitdir = gitFile.slice("gitdir: ".length).trim();
      const rebaseHead = `${gitdir}/rebase-merge/head-name`;
      if (fs.existsSync(rebaseHead)) {
        const ref = fs.readFileSync(rebaseHead, "utf8").trim();
        if (ref) {
          return ref.replace(/^refs\/heads\//, "");
        }
      }
      // 3. Symbolic HEAD ref inside the worktree's gitdir.
      const headFile = `${gitdir}/HEAD`;
      if (fs.existsSync(headFile)) {
        const head = fs.readFileSync(headFile, "utf8").trim();
        if (head.startsWith("ref: ")) {
          return head.slice("ref: ".length).replace(/^refs\/heads\//, "");
        }
      }
    }
  } catch {
    // Fall through to metadata / in-memory lookup.
  }

  // 2. Last known branch from in-memory state or persisted metadata. We don't
  //    record the branch in metadata today, so fall back to whatever the
  //    in-memory workspace reports for this path.
  for (const ws of appState.sessions.values()) {
    if (ws.path === worktreePath && ws.branch) {
      return ws.branch;
    }
  }
  // Silence unused-param lint — kept for future metadata-based lookup.
  if (meta) {
    // no-op
  }

  return null;
}
