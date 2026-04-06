/**
 * Workspace lifecycle management: create, delete, list git worktrees.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { appState } from "../../state";
import { getMainWindow } from "../../main";
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
  WorkspaceMeta,
} from "./metadata";
import { defaultStagehandConfig, Workspace, WorkspaceStatus } from "./models";
import { loadStagehandConfig, runSetupPipeline } from "./setup";
import { startBranchWatcher } from "./watcher";

// ---------------------------------------------------------------------------
// add_repo_root / remove_repo_root
// ---------------------------------------------------------------------------

/** Add a repository root to the set of open projects. */
export function addRepoRoot(dirPath: string): void {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw `Path is not a directory: ${dirPath}`;
  }
  console.info(`Adding repo root: ${dirPath}`);
  appState.repoRoots.add(dirPath);
}

/** Remove a repository root from the set of open projects. */
export function removeRepoRoot(dirPath: string): void {
  appState.repoRoots.delete(dirPath);

  // Find workspace IDs belonging to this repo root.
  const wsIds: string[] = [];
  for (const ws of appState.workspaces.values()) {
    if (ws.repo_root === dirPath) {
      wsIds.push(ws.id);
    }
  }

  // Kill agents for those workspaces.
  for (const [key, session] of appState.agents.entries()) {
    if (wsIds.includes(session.workspaceId)) {
      try {
        session.child.kill();
      } catch (e) {
        console.info(`removeRepoRoot: kill agent ${key} returned:`, e);
      }
      appState.agents.delete(key);
    }
  }

  // Kill terminal sessions associated with these workspaces.
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

  // Remove workspaces from state.
  for (const wsId of wsIds) {
    appState.workspaces.delete(wsId);
  }

  console.info(`Removed repo root and ${wsIds.length} workspaces: ${dirPath}`);
}

// ---------------------------------------------------------------------------
// list_workspaces
// ---------------------------------------------------------------------------

/**
 * Return all managed workspaces for the given repo root.
 *
 * Merges live in-memory state (descriptions, statuses, display names) with the
 * worktrees discovered on disk via `git worktree list`. Persisted metadata is
 * loaded and migrated to remove orphaned entries.
 */
export async function listWorkspaces(repoRoot: string): Promise<Workspace[]> {
  const worktreesDir = worktreesRoot(repoRoot);
  const diskWorkspaces = await listWorktrees(repoRoot);

  // Load persisted metadata and migrate away orphaned entries.
  const rawMeta = loadMetadata(worktreesDir);
  const [meta] = migrateOrphaned(worktreesDir, rawMeta);

  // Remove from in-memory state any workspaces whose paths no longer exist on disk.
  const livePaths = new Set(diskWorkspaces.map((w) => w.path));
  for (const [id, ws] of appState.workspaces.entries()) {
    if (
      ws.repo_root === repoRoot &&
      ws.kind !== "repo_root" &&
      !livePaths.has(ws.path)
    ) {
      appState.workspaces.delete(id);
    }
  }

  // Merge: for each worktree on disk, apply persisted metadata and in-memory state.
  const merged: Workspace[] = diskWorkspaces.map((ws) => {
    // Apply in-memory state first.
    const existing = [...appState.workspaces.values()].find(
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
    }

    if (!appState.workspaces.has(ws.id)) {
      appState.workspaces.set(ws.id, { ...ws });
    }

    return ws;
  });

  // Persist metadata for all live worktrees.
  const metaToSave = new Map<string, WorkspaceMeta>();
  for (const w of merged) {
    if (w.kind === "worktree") {
      metaToSave.set(w.path, {
        id: w.id,
        display_name: w.display_name,
        description: w.description,
        base_branch: w.base_branch,
      });
    }
  }
  try {
    saveMetadata(worktreesDir, metaToSave);
  } catch {
    // Non-fatal
  }

  // Include repo-root workspaces (not discovered via git worktree list).
  for (const ws of appState.workspaces.values()) {
    if (ws.kind === "repo_root" && ws.repo_root === repoRoot) {
      try {
        ws.branch = (
          await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
        ).trim();
        appState.workspaces.set(ws.id, ws);
      } catch {
        // Keep existing branch name on failure.
      }
      merged.push({ ...ws });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// create_workspace
// ---------------------------------------------------------------------------

/**
 * Create a new workspace (git worktree + branch) and run the setup pipeline.
 *
 * Returns immediately with the workspace in `initializing` status. The setup
 * pipeline runs asynchronously in the background, emitting
 * `workspace:status:{id}` when complete.
 */
export async function createWorkspace(
  repoRoot: string,
  branch: string,
  description: string,
  useExistingBranch?: boolean,
): Promise<Workspace> {
  // Capture the current branch as the base branch before creating the worktree.
  let baseBranch: string | undefined;
  try {
    baseBranch = (
      await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
  } catch {
    baseBranch = undefined;
  }

  let workspace: Workspace;
  if (useExistingBranch === true) {
    workspace = await createWorktreeFromExisting(
      repoRoot,
      branch,
      description,
      baseBranch,
    );
  } else {
    workspace = await createWorktree(repoRoot, branch, description, baseBranch);
  }

  // Assign sequential env_index.
  const nextIndex = [...appState.workspaces.values()].filter(
    (w) => w.kind !== "repo_root",
  ).length;
  workspace.env_index = nextIndex;
  appState.workspaces.set(workspace.id, { ...workspace });

  // Persist display name and base_branch so it survives app restarts.
  const worktreesDir = worktreesRoot(repoRoot);
  const meta = loadMetadata(worktreesDir);
  meta.set(workspace.path, {
    id: workspace.id,
    display_name: workspace.display_name,
    description: workspace.description,
    base_branch: workspace.base_branch,
  });
  try {
    saveMetadata(worktreesDir, meta);
  } catch {
    // Non-fatal
  }

  const config = loadStagehandConfig(repoRoot) ?? defaultStagehandConfig();
  const setupSessionId = `setup:${workspace.id}`;
  const taskWorkspaceId = workspace.id;
  const taskWorkspacePath = workspace.path;

  console.info(
    `Spawning setup pipeline for workspace ${taskWorkspaceId} (path=${taskWorkspacePath})`,
  );

  // Run setup pipeline in background (no await — returns immediately).
  runSetupPipeline(repoRoot, taskWorkspacePath, config, setupSessionId)
    .then(() => {
      const finalStatus: WorkspaceStatus = "ready";
      const ws = appState.workspaces.get(taskWorkspaceId);
      if (ws) {
        ws.status = finalStatus;
        appState.workspaces.set(taskWorkspaceId, ws);
      }
      getMainWindow()?.webContents.send(
        `workspace:status:${taskWorkspaceId}`,
        "ready",
      );
    })
    .catch((e: unknown) => {
      const errMsg = typeof e === "string" ? e : String(e);
      console.error(
        `Setup pipeline failed for workspace ${taskWorkspaceId}: ${errMsg}`,
      );
      const finalStatus: WorkspaceStatus = { error: errMsg };
      const ws = appState.workspaces.get(taskWorkspaceId);
      if (ws) {
        ws.status = finalStatus;
        appState.workspaces.set(taskWorkspaceId, ws);
      }
      getMainWindow()?.webContents.send(
        `workspace:status:${taskWorkspaceId}`,
        `error:${errMsg}`,
      );
    });

  return workspace;
}

// ---------------------------------------------------------------------------
// create_head_workspace
// ---------------------------------------------------------------------------

/**
 * Create (or return existing) repo-root workspace that runs on HEAD.
 *
 * There can be at most one repo-root workspace per repo.
 */
export function createHeadWorkspace(repoRoot: string): Workspace {
  // Return existing repo-root workspace for this repo if one exists.
  for (const ws of appState.workspaces.values()) {
    if (ws.kind === "repo_root" && ws.repo_root === repoRoot) {
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

  const ws: Workspace = {
    id: crypto.randomUUID(),
    kind: "repo_root",
    branch,
    display_name: null,
    description: "",
    path: repoRoot,
    repo_root: repoRoot,
    status: "ready",
    env_index: null,
    base_branch: null,
  };

  appState.workspaces.set(ws.id, ws);

  // Watch .git/HEAD for external branch switches.
  const branchHandle = startBranchWatcher(repoRoot, ws.id);
  appState.watchers.set(ws.id, branchHandle);

  console.info(`Created repo-root (HEAD) workspace ${ws.id}`);
  return { ...ws };
}

// ---------------------------------------------------------------------------
// delete_workspace
// ---------------------------------------------------------------------------

/**
 * Delete a workspace: kill its agent and terminals, remove the worktree.
 *
 * Returns immediately after cleaning up in-memory state. The actual
 * `git worktree remove` runs asynchronously. On background failure, emits
 * `workspace:delete-failed` with `{ id, error }`.
 */
export async function deleteWorkspace(
  id: string,
  shouldDeleteBranch?: boolean,
): Promise<void> {
  const workspace = appState.workspaces.get(id);
  if (!workspace) {
    throw `Workspace not found: ${id}`;
  }
  const repoRoot = workspace.repo_root;

  // Kill all agent sessions for this workspace.
  for (const [key, session] of appState.agents.entries()) {
    if (session.workspaceId === id) {
      try {
        session.child.kill();
      } catch (e) {
        console.info(`deleteWorkspace: kill agent ${key} returned:`, e);
      }
      appState.agents.delete(key);
    }
  }

  // Kill terminal sessions associated with this workspace.
  for (const key of appState.terminals.keys()) {
    if (key.includes(id)) {
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

  // Stop file watcher for this workspace.
  const watcher = appState.watchers.get(id);
  if (watcher) {
    watcher.stop();
    appState.watchers.delete(id);
  }

  // Remove from in-memory state immediately so the UI updates without delay.
  appState.workspaces.delete(id);

  if (workspace.kind !== "repo_root") {
    const taskRepoRoot = repoRoot;
    const taskWorkspacePath = workspace.path;
    const taskBranch = workspace.branch;
    const taskDeleteBranch = shouldDeleteBranch ?? false;
    const taskId = id;

    // Run the heavy work in the background.
    (async () => {
      try {
        await git(taskRepoRoot, [
          "worktree",
          "remove",
          "--force",
          taskWorkspacePath,
        ]);
        await git(taskRepoRoot, ["worktree", "prune"]);
      } catch (e) {
        const errMsg = typeof e === "string" ? e : String(e);
        console.error(
          `Background delete failed for workspace ${taskId}: ${errMsg}`,
        );
        getMainWindow()?.webContents.send("workspace:delete-failed", {
          id: taskId,
          error: errMsg,
        });
        return;
      }

      if (taskDeleteBranch) {
        try {
          await git(taskRepoRoot, ["branch", "-D", taskBranch]);
        } catch (e) {
          console.error(`Failed to delete branch '${taskBranch}':`, e);
          // Not fatal — worktree is already removed.
        }
      }

      const worktreesDir = worktreesRoot(taskRepoRoot);
      const meta = loadMetadata(worktreesDir);
      meta.delete(taskWorkspacePath);
      try {
        saveMetadata(worktreesDir, meta);
      } catch {
        // Non-fatal
      }

      console.info(`Deleted workspace ${taskId} (background)`);
    })();
  } else {
    console.info(`Deleted workspace ${id}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers: createWorktree / createWorktreeFromExisting
// ---------------------------------------------------------------------------

/**
 * Create a new worktree for `branch` branching from the current HEAD of the
 * main repo. Returns the new `Workspace` in `initializing` status.
 */
async function createWorktree(
  repoRoot: string,
  branch: string,
  description: string,
  baseBranch: string | undefined,
): Promise<Workspace> {
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

    console.info(`Removing orphaned worktree directory: ${worktreePath}`);
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  fs.mkdirSync(worktreesDir, { recursive: true });

  await git(repoRoot, [
    "worktree",
    "add",
    "-b",
    branchSlug,
    worktreePath,
    "HEAD",
  ]);

  console.info(
    `Created worktree for branch '${branchSlug}' at ${worktreePath}`,
  );

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
): Promise<Workspace> {
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

  console.info(
    `Created worktree for existing branch '${branch}' at ${worktreePath}`,
  );

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
 * Return all existing worktrees for `repoRoot` as `Workspace` values by
 * parsing `git worktree list --porcelain`.
 */
async function listWorktrees(repoRoot: string): Promise<Workspace[]> {
  await repairOrphanedWorktrees(repoRoot);

  const raw = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  const root = worktreesRoot(repoRoot);

  const workspaces: Workspace[] = [];
  let currentPath: string | null = null;
  let currentBranch: string | null = null;

  const lines = raw.split("\n");
  // Ensure a trailing blank line so the final block is flushed.
  if (lines[lines.length - 1] !== "") lines.push("");

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
      if (currentPath && currentBranch) {
        if (currentPath.startsWith(root) && isValidWorktree(currentPath)) {
          workspaces.push({
            id: crypto.randomUUID(),
            kind: "worktree",
            branch: currentBranch,
            display_name: null,
            description: "",
            path: currentPath,
            repo_root: repoRoot,
            status: "ready",
            env_index: null,
            base_branch: null,
          });
        }
      }
      currentPath = null;
      currentBranch = null;
    }
  }

  return workspaces;
}
