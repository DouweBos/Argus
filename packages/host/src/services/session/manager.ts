/**
 * Session lifecycle management: create, delete, list git worktrees.
 */

import type { WorktreePurpose } from "./worktreeLocationCore";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { error, info } from "@argus/host/logger";
import { canonicalPath } from "../../lib/canonicalPath";
import { appState } from "../../state";
import { loadAppSettings } from "../appSettings/store";
import { type AppDefaultLlm, resolveRunnerForSession } from "../llm/resolve";
import { forkClaudeSessionFile } from "../llm/runners/claudeCode/transcriptFork";
import {
  generateBranchAndTitle,
  generateSessionTitle,
  humanizeBranchName,
} from "../llm/titleGenerator";
import { collectAllProjects } from "../mcp/projectDiscovery";
import { disposeScratchPad } from "../scratchPad/manager";
import { updateScratchPadRecord } from "../scratchPad/store";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import {
  createTerminal,
  SETUP_TERMINAL_TITLE,
  setupShellCommand,
} from "../terminal/multiplexer";
import {
  applyBranchPrefix,
  loadUserProjectSettings,
} from "../userProjectSettings/store";
import { loadArgusConfig } from "./argusConfig";
import {
  effectiveAutoFetchMinutes,
  reconfigureAutoFetch,
  stopAutoFetch,
} from "./autoFetch";
import {
  addWorktree,
  branchToDir,
  git,
  removeWorktree,
  repairOrphanedWorktrees,
  titleToBranchSlug,
  worktreesRoot,
} from "./git";
import { attachGitWatcher, detachGitWatcher } from "./gitWatcher";
import {
  getMeta,
  isValidWorktree,
  loadMetadata,
  migrateOrphaned,
  normalizeMetaKey,
  saveMetadata,
  type SessionMeta,
} from "./metadata";
import { defaultArgusConfig, type Session, type SessionStatus } from "./models";
import { clearSessionProgress, trackDeleteProgress } from "./progress";
import { loadPersistedRepoRoots, persistRepoRoots } from "./repoRootsStore";
import { runSetupPipeline } from "./setup";
import { evacuateWorktreeRoots } from "./sidecars";
import {
  assertWorktreeBaseAvailable,
  isOnMissingVolume,
  mountRootFor,
  pathAvailability,
} from "./volumeAvailability";
import { startBranchWatcher } from "./watcher";
import { isKnownWorktreePath } from "./worktreeLocation";

// ---------------------------------------------------------------------------
// add_repo_root / remove_repo_root
// ---------------------------------------------------------------------------

/** Add a repository root to the set of open projects. */
export function addRepoRoot(rawPath: string): void {
  // `a/../a` and a trailing slash are the same project; keyed raw they'd be two.
  const dirPath = path.resolve(rawPath);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw `Path is not a directory: ${dirPath}`;
  }
  if (appState.repoRoots.has(dirPath)) {
    return;
  }
  info(`Adding repo root: ${dirPath}`);
  appState.repoRoots.add(dirPath);
  saveRepoRoots();
  emitHostEvent("project:added", dirPath);
}

/**
 * Saved roots we couldn't register at boot because their volume wasn't
 * mounted. Held so a later add/remove doesn't quietly drop them from the file.
 */
const unreachableRepoRoots = new Set<string>();

function saveRepoRoots(): void {
  persistRepoRoots([...appState.repoRoots, ...unreachableRepoRoots]);
}

/**
 * Re-register the roots a previous run had open, so a host comes back with the
 * same projects even when no client has asked for them yet. Roots on a volume
 * that isn't mounted stay saved and are picked up on a later launch.
 */
export function restoreRepoRoots(): void {
  for (const dirPath of loadPersistedRepoRoots()) {
    if (appState.repoRoots.has(dirPath)) {
      continue;
    }
    let isDir = false;
    try {
      isDir = fs.statSync(dirPath).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      info(`Repo root not reachable, leaving it saved: ${dirPath}`);
      unreachableRepoRoots.add(dirPath);
      continue;
    }
    info(`Restoring repo root: ${dirPath}`);
    appState.repoRoots.add(dirPath);
    emitHostEvent("project:added", dirPath);
  }
}

/** Remove a repository root from the set of open projects. */
export function removeRepoRoot(dirPath: string): void {
  appState.repoRoots.delete(dirPath);
  unreachableRepoRoots.delete(dirPath);
  saveRepoRoots();
  emitHostEvent("project:removed", dirPath);

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
      session.handle.kill().catch((e) => {
        info(`removeRepoRoot: kill agent ${key} returned:`, e);
      });
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

  // Stop file watchers and auto-fetch timers.
  for (const wsId of wsIds) {
    const handle = appState.watchers.get(wsId);
    if (handle) {
      handle.stop();
      appState.watchers.delete(wsId);
    }
    detachGitWatcher(wsId);
    stopAutoFetch(wsId);
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
 * Worktrees a pending session is still checking out. Git registers the path
 * long before `worktree add` returns, and listing must not adopt it as a
 * second session that then outlives the real one and keeps its branch taken.
 */
const creatingWorktreePaths = new Set<string>();

/**
 * Mark a session unreachable when its drive is disconnected, so the UI can
 * show it greyed out rather than having it silently disappear.
 */
function stampAvailability(ws: Session): void {
  ws.volume = ws.path ? mountRootFor(ws.path, process.platform) : null;
  const availability = pathAvailability(ws.path);
  if (availability.state === "volume_missing") {
    ws.availability = "unavailable";
    ws.unavailable_reason = "volume_missing";
    ws.unavailable_volume = availability.volume;

    return;
  }
  ws.availability = "available";
  ws.unavailable_reason = undefined;
  ws.unavailable_volume = null;
}

/**
 * Return all managed sessions for the given repo root.
 *
 * Merges live in-memory state (descriptions, statuses, display names) with the
 * worktrees discovered on disk via `git worktree list`. Persisted metadata is
 * loaded and migrated to remove orphaned entries.
 */
export async function listSessions(repoRoot: string): Promise<Session[]> {
  const diskSessions = (await listWorktrees(repoRoot)).filter(
    (w) => !creatingWorktreePaths.has(w.path),
  );

  // Load persisted metadata and migrate away orphaned entries.
  const rawMeta = loadMetadata(repoRoot);
  const [meta] = migrateOrphaned(repoRoot, rawMeta);
  evacuateWorktreeRoots(repoRoot);

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
      // A session with no path hasn't been placed on disk yet — the worktree
      // is still being created by `finalizeSession`. Skip it; deleting would
      // cause `finalizeSession`'s `appState.sessions.has(id)` guards to bail
      // silently and leave the renderer stuck in "initializing" forever.
      if (!ws.path) {
        continue;
      }
      if (isValidWorktree(ws.path) || isOnMissingVolume(ws.path)) {
        // Unreachable is not gone: a session whose drive is unplugged keeps
        // its place so the sidebar can show it, greyed out.
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
      ws.runner_id = m.runner_id ?? null;
      ws.model = m.model ?? null;
      ws.claude_account_id = m.claude_account_id ?? null;
    }

    stampAvailability(ws);

    if (!appState.sessions.has(ws.id)) {
      appState.sessions.set(ws.id, { ...ws });
    }

    return ws;
  });

  // Sessions the index knows about that nothing above could see, because the
  // drive holding them is disconnected. Without this they would only survive
  // as long as the app stayed running — after a restart `appState` is empty
  // and the index is the only place they exist.
  for (const [pathKey, entry] of meta) {
    if (livePaths.has(pathKey) || entry.kind === "project_root") {
      continue;
    }
    const availability = pathAvailability(pathKey);
    if (availability.state !== "volume_missing") {
      continue;
    }
    merged.push({
      id: entry.id,
      kind: entry.kind ?? "worktree",
      branch: entry.branch ?? "",
      display_name: entry.display_name,
      description: entry.description,
      path: pathKey,
      repo_root: repoRoot,
      status: "ready",
      env_index: null,
      base_branch: entry.base_branch ?? null,
      runner_id: entry.runner_id ?? null,
      model: entry.model ?? null,
      claude_account_id: entry.claude_account_id ?? null,
      availability: "unavailable",
      unavailable_reason: "volume_missing",
      unavailable_volume: availability.volume,
      volume: availability.volume,
    });
  }

  // Persist metadata for all live worktrees. Entries we could not see this
  // time are carried over untouched: `migrateOrphaned` has already dropped the
  // genuinely deleted ones, so what is left is on a disconnected drive and is
  // the only record of what those sessions were.
  const metaToSave = new Map<string, SessionMeta>(meta);
  for (const w of merged) {
    if (w.kind === "worktree") {
      metaToSave.set(normalizeMetaKey(w.path), {
        id: w.id,
        display_name: w.display_name,
        description: w.description,
        base_branch: w.base_branch,
        runner_id: w.runner_id ?? null,
        model: w.model ?? null,
        claude_account_id: w.claude_account_id ?? null,
        // Recorded so the row can still be drawn with the files unreachable.
        branch: w.branch,
        kind: w.kind,
        last_seen_at: w.availability === "unavailable" ? undefined : Date.now(),
      });
    }
  }
  try {
    saveMetadata(repoRoot, metaToSave);
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
 * Returns immediately with the session in `initializing` status and a freshly
 * minted id. Branch-name generation, worktree creation, and the setup
 * pipeline all run asynchronously in the background — progress is reported
 * via `session:updated` (branch/path/display_name/status) and
 * `session:status:{id}` events. The id is stable from the first response.
 */
export interface CreateSessionOptions {
  useExistingBranch?: boolean;
  explicitBaseBranch?: string;
  /**
   * If set, createSession's promise resolves only once the worktree exists
   * (path/branch populated). The setup pipeline still runs in the background
   * after the returned promise resolves.
   */
  awaitWorktreeReady?: boolean;
  /**
   * Runs after the worktree has been created and `session:updated` has been
   * emitted, but before the setup pipeline starts. Used by `forkSession` to
   * reset the new worktree to the fork commit and replay tool ops.
   *
   * If `awaitWorktreeReady` is set, createSession awaits this hook before
   * resolving.
   */
  postWorktreeReady?: (session: Session) => Promise<void>;
  /**
   * Which base directory the worktree is created under. Automations can be
   * pointed at a separate drive; see `worktreeLocation.ts`.
   */
  worktreePurpose?: WorktreePurpose;
}

/**
 * Reject a repo root that isn't a known project. `.argus.json`'s setup pipeline
 * runs on create, so an unvetted root — from a remote device or an MCP caller —
 * would be arbitrary code execution. Callers register the project first.
 */
function requireKnownProject(repoRoot: string): void {
  if (
    !appState.repoRoots.has(repoRoot) &&
    !collectAllProjects().some((p) => p.path === repoRoot)
  ) {
    throw `unknown project: ${repoRoot}`;
  }
}

export async function createSession(
  repoRoot: string,
  branch: string,
  description: string,
  useExistingBranch?: boolean,
  explicitBaseBranch?: string,
  sessionLlm?: AppDefaultLlm,
  opts?: Pick<
    CreateSessionOptions,
    "awaitWorktreeReady" | "postWorktreeReady" | "worktreePurpose"
  >,
): Promise<Session> {
  requireKnownProject(repoRoot);
  const id = crypto.randomUUID();

  // Resolve the runner *now* — it's immutable for the session's lifetime.
  // The cascade (project → app → single registered) is shared with future
  // sessions; throwing here means create_session fails fast with a clear
  // message instead of every later spawn_agent erroring.
  let argusConfig:
    | { llm?: { runner?: string | null; model?: string | null } | null }
    | undefined;
  try {
    argusConfig = loadArgusConfig(repoRoot);
  } catch {
    argusConfig = undefined;
  }
  const appDefaultLlm = loadAppSettings().default_llm ?? undefined;
  const { runner: chosenRunner, defaultModel } = resolveRunnerForSession({
    repoRoot,
    explicit: sessionLlm,
    argusConfig,
    appDefault: appDefaultLlm,
  });
  const initialModel =
    defaultModel ??
    (sessionLlm?.model ? sessionLlm.model.trim() : null) ??
    (appDefaultLlm?.model ? appDefaultLlm.model.trim() : null);

  // Provisional display name so the sidebar row has something readable before
  // branch generation returns. Prefer the user-typed branch, then the first
  // line of the description, then a generic fallback.
  const provisionalName =
    branch.trim() ||
    description.trim().split(/\r?\n/)[0].slice(0, 60) ||
    "New session";

  const nextIndex = [...appState.sessions.values()].filter(
    (w) => w.kind !== "project_root",
  ).length;

  const pending: Session = {
    id,
    kind: "worktree",
    branch: "",
    display_name: provisionalName,
    description,
    path: "",
    repo_root: repoRoot,
    status: "initializing",
    env_index: nextIndex,
    base_branch: explicitBaseBranch ?? null,
    runner_id: chosenRunner.id,
    model: initialModel,
  };
  appState.sessions.set(id, { ...pending });
  emitHostEvent("session:created", { ...pending });

  telemetryCapture("session_created", {
    has_explicit_branch: branch.trim().length > 0,
    has_description: description.trim().length > 0,
    use_existing_branch: Boolean(useExistingBranch),
    has_explicit_base_branch: Boolean(explicitBaseBranch),
  });

  let signalReady: ((s: Session) => void) | undefined;
  let signalReadyError: ((err: unknown) => void) | undefined;
  const ready = new Promise<Session>((resolve, reject) => {
    signalReady = resolve;
    signalReadyError = reject;
  });
  // Suppress unhandled rejection if no one awaits this promise.
  ready.catch(() => {});

  // Kick off the real work in the background. Don't await — callers without
  // `awaitWorktreeReady` get the pending session back immediately.
  finalizeSession(id, repoRoot, branch, description, {
    useExistingBranch,
    explicitBaseBranch,
    postWorktreeReady: opts?.postWorktreeReady,
    worktreePurpose: opts?.worktreePurpose,
    signalWorktreeReady: signalReady,
    signalWorktreeFailed: signalReadyError,
  }).catch((e: unknown) => {
    error(`finalizeSession unhandled: ${String(e)}`);
  });

  if (opts?.awaitWorktreeReady) {
    return await ready;
  }

  return { ...pending };
}

/**
 * Resolve the branch name (asking claude -p if needed), create the git
 * worktree, and run the setup pipeline for a session that was already
 * inserted into `appState.sessions` with status `initializing`.
 *
 * At every async boundary we re-check that the session still exists — the
 * user may have deleted it mid-resolve, in which case we clean up and bail.
 */
async function finalizeSession(
  id: string,
  repoRoot: string,
  branch: string,
  description: string,
  opts: {
    useExistingBranch?: boolean;
    explicitBaseBranch?: string;
    postWorktreeReady?: (session: Session) => Promise<void>;
    worktreePurpose?: WorktreePurpose;
    signalWorktreeReady?: (session: Session) => void;
    signalWorktreeFailed?: (err: unknown) => void;
  },
): Promise<void> {
  const {
    useExistingBranch,
    explicitBaseBranch,
    postWorktreeReady,
    worktreePurpose,
    signalWorktreeReady,
    signalWorktreeFailed,
  } = opts;

  const emitError = (msg: string) => {
    const ws = appState.sessions.get(id);
    if (!ws) {
      return;
    }
    ws.status = { error: msg };
    appState.sessions.set(id, ws);
    emitHostEvent(`session:status:${id}`, `error:${msg}`);
    signalWorktreeFailed?.(msg);
  };

  try {
    // --- Phase 1: resolve branch name + optional pre-generated title ------
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

    if (!appState.sessions.has(id)) {
      return; // Deleted mid-resolve.
    }

    // --- Phase 2: uniqueness check ---------------------------------------
    const branchSlug =
      useExistingBranch === true ? branchInput : titleToBranchSlug(branchInput);
    for (const existing of appState.sessions.values()) {
      if (
        existing.id !== id &&
        existing.kind === "worktree" &&
        existing.repo_root === repoRoot &&
        existing.branch === branchSlug
      ) {
        const label = existing.display_name ?? existing.branch;
        emitError(
          `Branch "${branchSlug}" is already used by session "${label}". Each branch can only be used by one session.`,
        );

        return;
      }
    }

    // --- Phase 3: resolve base branch ------------------------------------
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

    if (!appState.sessions.has(id)) {
      return;
    }

    // --- Phase 4: create the worktree ------------------------------------
    const worktreeInfo =
      useExistingBranch === true
        ? await checkoutBranchIntoWorktree(
            repoRoot,
            branchInput,
            baseBranch,
            worktreePurpose,
          )
        : await createWorktree(
            repoRoot,
            branchInput,
            baseBranch,
            worktreePurpose,
          );

    // If the session was deleted while we were creating the worktree, tear
    // the worktree back down instead of leaking the directory.
    if (!appState.sessions.has(id)) {
      try {
        await removeWorktree(repoRoot, worktreeInfo.path);
      } catch (e) {
        info(
          `finalizeSession: cleanup of orphaned worktree failed: ${String(e)}`,
        );
      } finally {
        creatingWorktreePaths.delete(worktreeInfo.path);
      }

      return;
    }

    // --- Phase 5: pick a display name -----------------------------------
    const provisional = appState.sessions.get(id)?.display_name ?? null;
    let displayName: string | null;
    if (preGeneratedTitle) {
      displayName = preGeneratedTitle;
    } else if (
      !provisional ||
      provisional === branch ||
      provisional === branchInput ||
      provisional === "New session"
    ) {
      displayName = humanizeBranchName(worktreeInfo.branch);
    } else {
      displayName = provisional;
    }

    // --- Phase 6: merge into state + notify renderer --------------------
    const ws = appState.sessions.get(id);
    creatingWorktreePaths.delete(worktreeInfo.path);
    if (!ws) {
      return;
    }
    ws.branch = worktreeInfo.branch;
    ws.path = worktreeInfo.path;
    ws.volume = mountRootFor(ws.path, process.platform);
    ws.base_branch = baseBranch ?? null;
    ws.display_name = displayName;
    ws.status = "initializing";
    appState.sessions.set(id, ws);

    emitHostEvent("session:updated", {
      id,
      branch: ws.branch,
      path: ws.path,
      volume: ws.volume,
      base_branch: ws.base_branch,
      display_name: ws.display_name,
      status: ws.status,
    });

    // --- Phase 6b: post-worktree hook (e.g. fork reset/replay) ----------
    if (postWorktreeReady) {
      try {
        await postWorktreeReady({ ...ws });
      } catch (e) {
        const msg =
          typeof e === "string" ? e : (e as Error).message || String(e);
        error(`postWorktreeReady failed for ${id}: ${msg}`);
        emitError(msg);

        return;
      }
      if (!appState.sessions.has(id)) {
        return;
      }
    }
    signalWorktreeReady?.({ ...ws });

    // --- Phase 7: persist metadata --------------------------------------
    const meta = loadMetadata(repoRoot);
    meta.set(ws.path, {
      id: ws.id,
      display_name: ws.display_name,
      description: ws.description,
      base_branch: ws.base_branch,
      runner_id: ws.runner_id ?? null,
      model: ws.model ?? null,
      claude_account_id: ws.claude_account_id ?? null,
    });
    try {
      saveMetadata(repoRoot, meta);
    } catch {
      // Non-fatal
    }

    // --- Phase 8: fire-and-forget nicer-title generation ---------------
    if (!preGeneratedTitle) {
      const titleSessionPath = ws.path;
      generateSessionTitle({
        branch: ws.branch,
        description: ws.description,
        repoRoot,
      })
        .then((title) => {
          if (!title) {
            return;
          }
          const current = appState.sessions.get(id);
          if (!current) {
            return;
          }
          current.display_name = title;
          appState.sessions.set(id, current);

          try {
            const metaNow = loadMetadata(repoRoot);
            const entry = metaNow.get(titleSessionPath) ?? {
              id: current.id,
              description: current.description,
              base_branch: current.base_branch,
            };
            metaNow.set(titleSessionPath, { ...entry, display_name: title });
            saveMetadata(repoRoot, metaNow);
          } catch {
            // Non-fatal
          }

          emitHostEvent("session:updated", {
            id,
            display_name: title,
          });
        })
        .catch((e: unknown) => {
          info(`Title generation skipped for session ${id}:`, e);
        });
    }

    // --- Phase 9: spawn setup terminal ---------------------------------
    // Boot through the user's login shell so rc files load — without that,
    // version-manager shims (mise, asdf, rbenv, nvm) aren't on PATH and setup
    // commands fall back to the system Ruby/Node/etc. It then hands off to a
    // line-editor-free shell so the commands the pipeline writes arrive
    // verbatim; see setupShellCommand().
    let setupTerminalId: string | null = null;
    try {
      setupTerminalId = createTerminal(
        id,
        undefined,
        setupShellCommand(),
        SETUP_TERMINAL_TITLE,
      );
      const t = appState.terminals.get(setupTerminalId);
      if (t) {
        t.locked = true;
      }
    } catch (e) {
      info(`Could not pre-spawn setup terminal for ${id}: ${String(e)}`);
    }
    if (setupTerminalId) {
      const stored = appState.sessions.get(id);
      if (stored) {
        stored.setup_terminal_id = setupTerminalId;
        appState.sessions.set(id, stored);
      }
      emitHostEvent(`session:setup_terminal:${id}`, {
        terminalId: setupTerminalId,
        title: "Setup",
      });
    }

    // --- Phase 10: run setup pipeline ----------------------------------
    const config = loadArgusConfig(repoRoot) ?? defaultArgusConfig();
    const taskSessionPath = ws.path;

    info(`Spawning setup pipeline for session ${id} (path=${taskSessionPath})`);

    runSetupPipeline(repoRoot, taskSessionPath, config, id, setupTerminalId)
      .then(() => {
        const finalStatus: SessionStatus = "ready";
        const current = appState.sessions.get(id);
        if (current) {
          current.status = finalStatus;
          appState.sessions.set(id, current);
        }
        emitHostEvent(`session:status:${id}`, "ready");
        const session = appState.sessions.get(id);
        if (session) {
          reconfigureAutoFetch(
            id,
            repoRoot,
            effectiveAutoFetchMinutes(
              session,
              config.auto_fetch_minutes,
              config.protected_branches,
            ),
          );
        }
      })
      .catch((e: unknown) => {
        const errMsg = typeof e === "string" ? e : String(e);
        error(`Setup pipeline failed for session ${id}: ${errMsg}`);
        const current = appState.sessions.get(id);
        if (current) {
          current.status = { error: errMsg };
          appState.sessions.set(id, current);
        }
        emitHostEvent(`session:status:${id}`, `error:${errMsg}`);
      });
  } catch (e) {
    const errMsg =
      typeof e === "string" ? e : (e as Error).message || String(e);
    error(`finalizeSession failed for ${id}: ${errMsg}`);
    // Without a terminal status the session sits in `initializing` forever and
    // anything awaiting it (a proposal accepted from the phone) never hears back.
    const current = appState.sessions.get(id);
    if (current) {
      current.status = { error: errMsg };
      appState.sessions.set(id, current);
    }
    emitHostEvent(`session:status:${id}`, `error:${errMsg}`);
    emitError(errMsg);
  }
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

  let newClaudeSessionId: string | null = null;

  // Wait for the new session's worktree to be created, then reset to the
  // fork commit, replay uncommitted edits, and copy/truncate the Claude
  // JSONL — all before the setup pipeline (and the agent) starts.
  const session = await createSession(
    repoRoot,
    newBranch,
    description,
    false,
    srcBranch,
    undefined,
    {
      awaitWorktreeReady: true,
      postWorktreeReady: async (s) => {
        if (forkCommit) {
          try {
            await git(s.path, ["reset", "--hard", forkCommit]);
          } catch (e) {
            info(`forkSession: reset to fork commit failed: ${String(e)}`);
          }
        }

        if (replayOps && replayOps.length > 0) {
          let commitTimeMs = 0;
          if (forkCommit) {
            try {
              const ct = (
                await git(s.path, ["show", "-s", "--format=%ct", forkCommit])
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
            s.path,
            commitTimeMs,
            forkTimestampMs,
          );
        }

        if (sourceClaudeSessionId) {
          try {
            newClaudeSessionId = await forkClaudeSessionFile({
              sourceCwd: srcPath,
              sourceSessionId: sourceClaudeSessionId,
              destCwd: s.path,
              destBranch: s.branch,
              forkTimestampMs,
              forkTurnNumber,
            });
          } catch (e) {
            info(`forkSession: JSONL truncation failed: ${String(e)}`);
            newClaudeSessionId = null;
          }
        }
      },
    },
  );

  info(
    `Forked session ${sourceSessionId} → ${session.id} (branch ${session.branch}, commit ${forkCommit || "<none>"}, claude ${newClaudeSessionId ?? "<none>"})`,
  );

  return { session, claude_session_id: newClaudeSessionId };
}

/**
 * Fork the Claude Code transcript only — same session, same worktree.
 *
 * Produces a new truncated JSONL inside the existing session's Claude
 * project directory so a fresh agent can `--resume` into it. The workspace
 * is left untouched (the new agent inherits whatever uncommitted state is
 * currently there); this is the "fork the conversation, not the workspace"
 * path.
 */
export async function forkChatInSession(
  sourceSessionId: string,
  sourceClaudeSessionId: string,
  forkTimestampMs: number,
  forkTurnNumber: number,
): Promise<{ claude_session_id: string | null }> {
  const source = appState.sessions.get(sourceSessionId);
  if (!source) {
    throw `Session not found: ${sourceSessionId}`;
  }
  if (source.kind !== "worktree" && source.kind !== "project_root") {
    throw `Cannot fork a session of kind "${source.kind}"`;
  }
  const newClaudeSessionId = await forkClaudeSessionFile({
    sourceCwd: source.path,
    sourceSessionId: sourceClaudeSessionId,
    destCwd: source.path,
    destBranch: source.branch,
    forkTimestampMs,
    forkTurnNumber,
  });
  info(
    `Forked chat in session ${sourceSessionId} (claude ${newClaudeSessionId ?? "<none>"})`,
  );

  return { claude_session_id: newClaudeSessionId };
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

  // Reuse the persisted id so links and clients survive a host restart.
  const meta = loadMetadata(repoRoot);
  const saved = getMeta(meta, repoRoot);
  const ws: Session = {
    id: saved?.id ?? crypto.randomUUID(),
    kind: "project_root",
    branch,
    display_name: saved?.display_name ?? null,
    description: "",
    path: repoRoot,
    repo_root: repoRoot,
    status: "ready",
    env_index: null,
    base_branch: null,
  };

  appState.sessions.set(ws.id, ws);
  if (!saved) {
    try {
      meta.set(normalizeMetaKey(repoRoot), {
        id: ws.id,
        description: "",
        kind: "project_root",
        branch,
      });
      saveMetadata(repoRoot, meta);
    } catch (e) {
      info(`createHeadSession: persist metadata failed for ${repoRoot}:`, e);
    }
  }

  // Watch .git/HEAD for external branch switches.
  const branchHandle = startBranchWatcher(repoRoot, ws.id);
  appState.watchers.set(ws.id, branchHandle);

  // Attach git-status FS watcher (independent of the per-consumer diff-stats
  // watcher — see `attachGitWatcher`).
  attachGitWatcher(ws.id, ws.path).catch(() => {});

  // Start auto-fetch if configured — or, for project_root sessions on a
  // protected branch, kick off a default-cadence timer so the trunk's
  // ahead/behind stays current even without explicit `auto_fetch_minutes`.
  try {
    const argusConfig = loadArgusConfig(repoRoot);
    reconfigureAutoFetch(
      ws.id,
      repoRoot,
      effectiveAutoFetchMinutes(
        ws,
        argusConfig.auto_fetch_minutes,
        argusConfig.protected_branches,
      ),
    );
  } catch {
    // Config parse failure is non-fatal here.
  }

  emitHostEvent("session:created", { ...ws });

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
/**
 * Clear a session's failed-setup status and mark it ready.
 *
 * The user has presumably re-run the failed step manually in the worktree's
 * terminal. We just flip the in-memory status so the rest of the UI stops
 * blocking on the error — there's no on-disk state to repair.
 */
export function clearSessionSetupError(id: string): void {
  const session = appState.sessions.get(id);
  if (!session) {
    throw `Session not found: ${id}`;
  }
  if (typeof session.status === "string" || !("error" in session.status)) {
    return;
  }

  session.status = "ready";
  appState.sessions.set(id, session);
  emitHostEvent(`session:status:${id}`, "ready");
  telemetryCapture("session_setup_recovered", {
    action: "mark_ready",
    success: true,
  });
}

/**
 * Re-run the setup pipeline for a session whose initial setup failed. Flips
 * status back to `initializing`, spawns a fresh Setup terminal, and updates
 * status to `ready` or `{ error }` based on the outcome — mirroring the same
 * status transitions as the initial create_session flow.
 */
export function retrySessionSetup(id: string): void {
  const session = appState.sessions.get(id);
  if (!session) {
    throw `Session not found: ${id}`;
  }
  if (typeof session.status !== "object" || !("error" in session.status)) {
    throw `Session ${id} is not in a failed-setup state`;
  }

  session.status = "initializing";
  appState.sessions.set(id, session);
  emitHostEvent(`session:status:${id}`, "initializing");

  const config = loadArgusConfig(session.repo_root) ?? defaultArgusConfig();

  runSetupPipeline(
    session.repo_root,
    session.path,
    config,
    id,
    session.setup_terminal_id ?? null,
  )
    .then(() => {
      const current = appState.sessions.get(id);
      if (current) {
        current.status = "ready";
        appState.sessions.set(id, current);
      }
      emitHostEvent(`session:status:${id}`, "ready");
      telemetryCapture("session_setup_recovered", {
        action: "retry",
        success: true,
      });
      reconfigureAutoFetch(
        id,
        session.repo_root,
        effectiveAutoFetchMinutes(
          session,
          config.auto_fetch_minutes,
          config.protected_branches,
        ),
      );
    })
    .catch((e: unknown) => {
      const errMsg = typeof e === "string" ? e : String(e);
      error(`Setup retry failed for session ${id}: ${errMsg}`);
      const current = appState.sessions.get(id);
      if (current) {
        current.status = { error: errMsg };
        appState.sessions.set(id, current);
      }
      emitHostEvent(`session:status:${id}`, `error:${errMsg}`);
      telemetryCapture("session_setup_recovered", {
        action: "retry",
        success: false,
      });
    });
}

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

  if (session.kind === "scratch_pad") {
    updateScratchPadRecord(id, { display_name: trimmed });
    emitHostEvent("session:updated", { id, display_name: trimmed });

    return;
  }

  try {
    const meta = loadMetadata(session.repo_root);
    const existing = meta.get(session.path) ?? {
      id: session.id,
      description: session.description,
      base_branch: session.base_branch,
    };
    meta.set(session.path, { ...existing, display_name: trimmed });
    saveMetadata(session.repo_root, meta);
  } catch (e) {
    info(`renameSession: persist metadata failed for ${id}:`, e);
  }

  emitHostEvent("session:updated", {
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

  emitHostEvent("session:updated", {
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

  telemetryCapture("session_deleted", {
    kind: session.kind,
    delete_branch: Boolean(shouldDeleteBranch),
  });

  // Kill all agent sessions for this session.
  const killedAgentIds: string[] = [];
  for (const [key, agentEntry] of appState.agents.entries()) {
    if (agentEntry.sessionId === id) {
      agentEntry.handle.kill().catch((e) => {
        info(`deleteSession: kill agent ${key} returned:`, e);
      });
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
  detachGitWatcher(id);
  stopAutoFetch(id);

  // Notify the renderer that agents were killed.
  for (const agentId of killedAgentIds) {
    emitHostEvent(`agent:exit:${agentId}`, 0);
  }

  if (session.kind === "project_root" || session.kind === "scratch_pad") {
    // Neither has a worktree to remove on disk — delete immediately.
    if (session.kind === "scratch_pad") {
      disposeScratchPad(id);
    }
    appState.sessions.delete(id);
    emitHostEvent("session:deleted", id);
    info(`Deleted session ${id}`);

    return;
  }

  // Mark the session as "deleting" so the sidebar reflects the in-progress
  // state instead of showing stale content (e.g. a spike of reported
  // deletions from the file watcher) while the worktree is removed on disk.
  session.status = "deleting";
  appState.sessions.set(id, session);
  emitHostEvent(`session:status:${id}`, "deleting");

  const taskRepoRoot = repoRoot;
  const taskSessionPath = session.path;
  const taskBranch = session.branch;
  const taskDeleteBranch = shouldDeleteBranch ?? false;
  const taskId = id;

  // Run the heavy work in the background.
  (async () => {
    // git removes the files in one opaque call; counting what is left is the
    // only way to tell a slow removal from a stuck one.
    const stopTracking = await trackDeleteProgress(taskId, taskSessionPath);
    try {
      await removeWorktree(taskRepoRoot, taskSessionPath);
    } catch (e) {
      stopTracking();
      clearSessionProgress(taskId);
      const errMsg = typeof e === "string" ? e : String(e);
      error(`Background delete failed for session ${taskId}: ${errMsg}`);
      // Restore the session's status so the user can retry.
      const ws = appState.sessions.get(taskId);
      if (ws) {
        ws.status = { error: errMsg };
        appState.sessions.set(taskId, ws);
      }
      emitHostEvent(`session:status:${taskId}`, `error:${errMsg}`);
      emitHostEvent("session:delete-failed", {
        id: taskId,
        error: errMsg,
      });

      return;
    }
    stopTracking();
    clearSessionProgress(taskId);

    if (taskDeleteBranch) {
      try {
        await git(taskRepoRoot, ["branch", "-D", taskBranch]);
      } catch (e) {
        error(`Failed to delete branch '${taskBranch}':`, e);
        // Not fatal — worktree is already removed.
      }
    }

    const meta = loadMetadata(taskRepoRoot);
    meta.delete(taskSessionPath);
    try {
      saveMetadata(taskRepoRoot, meta);
    } catch {
      // Non-fatal
    }

    appState.sessions.delete(taskId);
    emitHostEvent("session:deleted", taskId);
    info(`Deleted session ${taskId} (background)`);
  })();
}

// ---------------------------------------------------------------------------
// Internal helpers: createWorktree / checkoutBranchIntoWorktree
// ---------------------------------------------------------------------------

/** Branch + path pair returned from the worktree-creation helpers. */
interface WorktreeInfo {
  branch: string;
  path: string;
}

/** `addWorktree` that keeps the path out of the session list until it is owned. */
async function addPendingWorktree(
  repoRoot: string,
  worktreePath: string,
  args: string[],
): Promise<void> {
  creatingWorktreePaths.add(worktreePath);
  try {
    await addWorktree(repoRoot, worktreePath, args);
  } catch (e) {
    creatingWorktreePaths.delete(worktreePath);
    throw e;
  }
}

/**
 * Create a new worktree for `branch` branching from `baseBranch` (or the
 * current HEAD of the main repo). Returns the final branch slug and on-disk
 * path.
 */
async function createWorktree(
  repoRoot: string,
  branch: string,
  baseBranch: string | undefined,
  purpose: WorktreePurpose = "user",
): Promise<WorktreeInfo> {
  const branchSlug = titleToBranchSlug(branch);
  // Spelled the way git will list it, or the session and git disagree on its path.
  const worktreesDir = canonicalPath(worktreesRoot(repoRoot, purpose));
  const dirName = branchToDir(branchSlug);
  const worktreePath = path.join(worktreesDir, dirName);

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

  assertWorktreeBaseAvailable(path.dirname(worktreesDir));
  fs.mkdirSync(worktreesDir, { recursive: true });

  await addPendingWorktree(repoRoot, worktreePath, [
    "-b",
    branchSlug,
    worktreePath,
    baseBranch ?? "HEAD",
  ]);

  info(`Created worktree for branch '${branchSlug}' at ${worktreePath}`);

  return { branch: branchSlug, path: worktreePath };
}

/**
 * Check out an existing branch into a new worktree. The branch may live
 * locally, on a remote-tracking ref, or only on the remote (in which case
 * we fetch it first — common for PR branches authored by someone else).
 * Finds a unique path by appending _2, _3, etc. if needed.
 */
async function checkoutBranchIntoWorktree(
  repoRoot: string,
  branch: string,
  _baseBranch: string | undefined,
  purpose: WorktreePurpose = "user",
): Promise<WorktreeInfo> {
  // Spelled the way git will list it, or the session and git disagree on its path.
  const worktreesDir = canonicalPath(worktreesRoot(repoRoot, purpose));
  const baseDir = branchToDir(branch);
  let worktreePath = `${worktreesDir}/${baseDir}`;
  let suffix = 2;
  while (fs.existsSync(worktreePath)) {
    worktreePath = `${worktreesDir}/${baseDir}_${suffix}`;
    suffix += 1;
  }

  assertWorktreeBaseAvailable(path.dirname(worktreesDir));
  fs.mkdirSync(worktreesDir, { recursive: true });

  // The branch may exist only as a remote-tracking ref (e.g. a PR branch
  // authored by someone else that hasn't been checked out locally yet). In
  // that case `git worktree add <path> <branch>` fails with "invalid
  // reference", so fall back to creating a local branch that tracks the
  // remote ref.
  let hasLocal = true;
  try {
    await git(repoRoot, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
  } catch {
    hasLocal = false;
  }

  if (hasLocal) {
    await addPendingWorktree(repoRoot, worktreePath, [worktreePath, branch]);
  } else {
    let remotes: string[] = [];
    try {
      remotes = (await git(repoRoot, ["remote"])).split("\n").filter(Boolean);
    } catch {
      // no remotes configured
    }

    const findRemoteRef = async (): Promise<string | null> => {
      for (const remote of remotes) {
        const candidate = `refs/remotes/${remote}/${branch}`;
        try {
          await git(repoRoot, ["rev-parse", "--verify", "--quiet", candidate]);

          return `${remote}/${branch}`;
        } catch {
          // try next remote
        }
      }

      return null;
    };

    let remoteRef = await findRemoteRef();

    // Branch may exist on the remote but not yet be fetched locally — common
    // when checking out a PR authored by someone else for the first time.
    // Try fetching the branch from each remote before giving up.
    if (!remoteRef) {
      for (const remote of remotes) {
        try {
          await git(repoRoot, ["fetch", remote, branch]);
        } catch {
          // branch likely doesn't exist on this remote — try next
        }
      }
      remoteRef = await findRemoteRef();
    }

    if (!remoteRef) {
      throw `Branch "${branch}" does not exist locally or on any remote. Fetch it first (e.g. \`git fetch\`) and try again.`;
    }

    await addPendingWorktree(repoRoot, worktreePath, [
      "-b",
      branch,
      worktreePath,
      remoteRef,
    ]);
  }

  info(`Created worktree for existing branch '${branch}' at ${worktreePath}`);

  return { branch, path: worktreePath };
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
  const meta = loadMetadata(repoRoot);

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
    // Any known root, not just the current one: changing the location leaves
    // existing worktrees behind, and they must stay visible until moved.
    // Containment, not `startsWith` — that matches a sibling `…-backup` dir.
    if (!isKnownWorktreePath(repoRoot, currentPath)) {
      return;
    }
    if (!isValidWorktree(currentPath) && !isOnMissingVolume(currentPath)) {
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
