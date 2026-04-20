/**
 * Workspace lifecycle management: create, delete, list git worktrees.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { error, info } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import {
  generateSessionTitle,
  humanizeBranchName,
} from "../llm/titleGenerator";
import { orgHostDir } from "../organizationTask/paths";
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
  type WorkspaceMeta,
} from "./metadata";
import {
  defaultArgusConfig,
  type Workspace,
  type WorkspaceStatus,
} from "./models";
import { loadArgusConfig, runSetupPipeline } from "./setup";
import { startBranchWatcher } from "./watcher";
import {
  applyBranchPrefix,
  loadUserProjectSettings,
} from "../userProjectSettings/store";

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
        info(`removeRepoRoot: kill agent ${key} returned:`, e);
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

  info(`Removed repo root and ${wsIds.length} workspaces: ${dirPath}`);
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

  // Remove from in-memory state any workspaces whose paths no longer exist on
  // disk. We only drop a workspace if the directory is genuinely gone — if git
  // is mid-operation (e.g. a rebase that briefly makes a worktree invisible),
  // `livePaths` may not contain it even though the directory still exists. In
  // that case we keep the in-memory entry and re-merge it below as a synthetic
  // disk entry so it survives the refresh.
  const livePaths = new Set(diskWorkspaces.map((w) => w.path));
  for (const [id, ws] of [...appState.workspaces.entries()]) {
    if (
      ws.repo_root === repoRoot &&
      ws.kind !== "repo_root" &&
      !livePaths.has(ws.path)
    ) {
      if (isValidWorktree(ws.path)) {
        diskWorkspaces.push({ ...ws });
        livePaths.add(ws.path);
      } else {
        appState.workspaces.delete(id);
      }
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
      ws.organization_task_id = m.organization_task_id ?? null;
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
        organization_task_id: w.organization_task_id ?? null,
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
  explicitBaseBranch?: string,
): Promise<Workspace> {
  // Apply the developer's personal required branch prefix (if configured) to
  // new branches. Existing branches are adopted as-is.
  let branchInput = branch;
  if (useExistingBranch !== true) {
    const prefix = loadUserProjectSettings(repoRoot).branch_prefix ?? "";
    branchInput = applyBranchPrefix(branch, prefix);
  }

  // Enforce one-session-per-branch: a given branch in a given repo may only be
  // claimed by a single worktree-kind workspace.
  const branchSlug =
    useExistingBranch === true ? branchInput : titleToBranchSlug(branchInput);
  for (const existing of appState.workspaces.values()) {
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

  let workspace: Workspace;
  if (useExistingBranch === true) {
    workspace = await createWorktreeFromExisting(
      repoRoot,
      branchInput,
      description,
      baseBranch,
    );
  } else {
    workspace = await createWorktree(
      repoRoot,
      branchInput,
      description,
      baseBranch,
    );
  }

  // Assign sequential env_index.
  const nextIndex = [...appState.workspaces.values()].filter(
    (w) => w.kind !== "repo_root",
  ).length;
  workspace.env_index = nextIndex;

  // Set a humanized placeholder title so the row renders something readable
  // before the LLM-generated title comes back.
  if (
    !workspace.display_name ||
    workspace.display_name === branch ||
    workspace.display_name === branchInput
  ) {
    workspace.display_name = humanizeBranchName(workspace.branch);
  }
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

  // Fire-and-forget: ask Claude for a nicer title. On success, update state,
  // persist, and notify the renderer so the row re-renders.
  const titleWorkspaceId = workspace.id;
  const titleWorkspacePath = workspace.path;
  generateSessionTitle({
    branch: workspace.branch,
    description: workspace.description,
    repoRoot,
  })
    .then((title) => {
      if (!title) {
        return;
      }
      const ws = appState.workspaces.get(titleWorkspaceId);
      if (!ws) {
        return;
      }
      ws.display_name = title;
      appState.workspaces.set(titleWorkspaceId, ws);

      try {
        const metaNow = loadMetadata(worktreesDir);
        const entry = metaNow.get(titleWorkspacePath) ?? {
          id: ws.id,
          description: ws.description,
          base_branch: ws.base_branch,
        };
        metaNow.set(titleWorkspacePath, { ...entry, display_name: title });
        saveMetadata(worktreesDir, metaNow);
      } catch {
        // Non-fatal
      }

      getMainWindow()?.webContents.send("workspace:updated", {
        id: titleWorkspaceId,
        display_name: title,
      });
    })
    .catch((e: unknown) => {
      info(`Title generation skipped for workspace ${titleWorkspaceId}:`, e);
    });

  const config = loadArgusConfig(repoRoot) ?? defaultArgusConfig();
  const setupSessionId = `setup:${workspace.id}`;
  const taskWorkspaceId = workspace.id;
  const taskWorkspacePath = workspace.path;

  info(
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
      error(
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
// create_org_host_workspace
// ---------------------------------------------------------------------------

/**
 * Create a neutral "org host" workspace for a cross-repo OrgTask.
 *
 * Unlike worktree workspaces, this workspace is not tied to any git repo —
 * it's a plain directory at `~/.argus/org-hosts/{orgId}/{taskId}/` where a
 * single agent runs with access to every scope repo via MCP tools.
 *
 * No git operations, no setup pipeline, no file watchers. Returns the
 * workspace in `ready` status.
 */
export async function createOrgHostWorkspace(options: {
  organizationId: string;
  taskId: string;
  displayName: string;
}): Promise<Workspace> {
  const dir = orgHostDir(options.organizationId, options.taskId);
  fs.mkdirSync(dir, { recursive: true });

  const ws: Workspace = {
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

  appState.workspaces.set(ws.id, ws);
  getMainWindow()?.webContents.send("workspace:created", { ...ws });
  info(`Created org-host workspace ${ws.id} at ${dir}`);

  return { ...ws };
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

  info(`Created repo-root (HEAD) workspace ${ws.id}`);

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
  const killedAgentIds: string[] = [];
  for (const [key, session] of appState.agents.entries()) {
    if (session.workspaceId === id) {
      try {
        session.child.kill();
      } catch (e) {
        info(`deleteWorkspace: kill agent ${key} returned:`, e);
      }
      appState.agents.delete(key);
      killedAgentIds.push(key);
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

  const win = getMainWindow();

  // Notify the renderer that agents were killed.
  if (win) {
    for (const agentId of killedAgentIds) {
      win.webContents.send(`agent:exit:${agentId}`, 0);
    }
  }

  if (workspace.kind === "repo_root") {
    // Repo-root workspaces don't have a worktree to remove on disk — delete
    // immediately.
    appState.workspaces.delete(id);
    win?.webContents.send("workspace:deleted", id);
    info(`Deleted workspace ${id}`);

    return;
  }

  if (workspace.kind === "org_host") {
    // Neutral org-host workspace — just remove the directory.
    try {
      fs.rmSync(workspace.path, { force: true, recursive: true });
    } catch (e) {
      info(`deleteWorkspace: rm org-host dir failed: ${String(e)}`);
    }
    appState.workspaces.delete(id);
    win?.webContents.send("workspace:deleted", id);
    info(`Deleted org-host workspace ${id}`);

    return;
  }

  // Mark the workspace as "deleting" so the sidebar reflects the in-progress
  // state instead of showing stale content (e.g. a spike of reported
  // deletions from the file watcher) while the worktree is removed on disk.
  workspace.status = "deleting";
  appState.workspaces.set(id, workspace);
  win?.webContents.send(`workspace:status:${id}`, "deleting");

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
      error(`Background delete failed for workspace ${taskId}: ${errMsg}`);
      // Restore the workspace's status so the user can retry.
      const ws = appState.workspaces.get(taskId);
      if (ws) {
        ws.status = { error: errMsg };
        appState.workspaces.set(taskId, ws);
      }
      getMainWindow()?.webContents.send(
        `workspace:status:${taskId}`,
        `error:${errMsg}`,
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
        error(`Failed to delete branch '${taskBranch}':`, e);
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

    appState.workspaces.delete(taskId);
    getMainWindow()?.webContents.send("workspace:deleted", taskId);
    info(`Deleted workspace ${taskId} (background)`);
  })();
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
 * Return all existing worktrees for `repoRoot` as `Workspace` values by
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
async function listWorktrees(repoRoot: string): Promise<Workspace[]> {
  await repairOrphanedWorktrees(repoRoot);

  const raw = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  const root = worktreesRoot(repoRoot);
  const meta = loadMetadata(worktreesRoot(repoRoot));

  const workspaces: Workspace[] = [];
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
    workspaces.push({
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

  return workspaces;
}

/**
 * Figure out the branch for a worktree that `git worktree list --porcelain`
 * reported without a `branch` line (detached HEAD — usually mid-rebase).
 */
function resolveDetachedBranch(
  worktreePath: string,
  meta: Map<string, WorkspaceMeta>,
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
  for (const ws of appState.workspaces.values()) {
    if (ws.path === worktreePath && ws.branch) {
      return ws.branch;
    }
  }
  // Silence unused-param lint — kept for future metadata-based lookup.
  void meta;

  return null;
}
