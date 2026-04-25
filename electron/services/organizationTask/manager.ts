/**
 * OrgTask CRUD and lookups. Mutations persist to `organization-tasks.json`
 * and emit an `organization_tasks:changed` event to the renderer.
 *
 * Retention: up to `MAX_ORG_TASKS_PER_ORG` terminal tasks are kept per org;
 * older ones are evicted on save and their host directories removed. Running
 * tasks are never evicted.
 */

import type { OrgTask, OrgTaskStatus } from "./models";
import type { Session } from "../session/models";
import crypto from "node:crypto";
import fs from "node:fs";
import { info, warn } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { orgHostDir, orgHostOrgDir } from "./paths";
import { loadOrgTasks, saveOrgTasks } from "./store";

/** Tasks idle for longer than this on startup are purged with their host dir. */
const ORG_TASK_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Max number of terminal (completed/failed/cancelled) tasks kept per org. */
export const MAX_ORG_TASKS_PER_ORG = 100;

const TERMINAL_STATUSES: ReadonlySet<OrgTaskStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function initOrgTasks(): void {
  const tasks = loadOrgTasks();
  const now = Date.now();
  let purged = 0;
  let restored = 0;

  for (const t of tasks) {
    const lastActivity = t.updated_at || t.created_at;
    const dir = orgHostDir(t.organization_id, t.id);
    const dirExists = fs.existsSync(dir);

    // Tasks idle for longer than the TTL — or whose host directory has
    // already vanished from disk — are unrecoverable. Drop them along with
    // their host dir so they don't accumulate.
    if (now - lastActivity > ORG_TASK_IDLE_TTL_MS || !dirExists) {
      removeHostDir(t);
      purged++;
      continue;
    }

    // The neutral org-host session itself is in-memory only and didn't
    // survive the restart, but the on-disk host directory and the task's
    // shared prompt/scope still exist. Recreate a fresh session pointed at
    // the same directory so the user can navigate to the task and spawn
    // new agents under it; the previous host agent process is gone so we
    // clear `host_agent_id` too.
    const session = restoreOrgHostSession(t, dir);
    appState.organizationTasks.set(t.id, {
      ...t,
      host_session_id: session.id,
      host_agent_id: null,
    });
    restored++;
  }

  info(
    `Loaded ${tasks.length - purged} organization task(s) from disk (purged ${purged}, restored ${restored} host session(s)).`,
  );

  if (purged > 0 || restored > 0) {
    persist();
  }

  // Run retention once so legacy on-disk state self-trims on startup.
  enforceRetention();
}

/**
 * Recreate the in-memory `org_host` session for a task whose on-disk host
 * directory survived a restart. Mirrors `createOrgHostSession` but reuses
 * the existing directory instead of creating a new one.
 */
function restoreOrgHostSession(task: OrgTask, dir: string): Session {
  const ws: Session = {
    id: crypto.randomUUID(),
    kind: "org_host",
    branch: "",
    display_name: task.title,
    description: "",
    path: dir,
    repo_root: dir,
    status: "ready",
    env_index: null,
    base_branch: null,
    organization_task_id: task.id,
  };
  appState.sessions.set(ws.id, ws);
  getMainWindow()?.webContents.send("session:created", { ...ws });

  return ws;
}

function persist(): void {
  saveOrgTasks([...appState.organizationTasks.values()]);
  getMainWindow()?.webContents.send("organization_tasks:changed");
}

/**
 * Enforce the per-org retention cap. Only terminal tasks can be evicted;
 * running tasks are always kept. Evicted tasks' host directories are removed
 * (best-effort). Persists + emits change if anything was evicted.
 */
function enforceRetention(): void {
  const byOrg = new Map<string, OrgTask[]>();
  for (const t of appState.organizationTasks.values()) {
    const list = byOrg.get(t.organization_id) ?? [];
    list.push(t);
    byOrg.set(t.organization_id, list);
  }

  let evictedAny = false;
  for (const [, tasks] of byOrg.entries()) {
    if (tasks.length <= MAX_ORG_TASKS_PER_ORG) {
      continue;
    }
    // Sort newest first so we keep the newest N.
    tasks.sort((a, b) => b.created_at - a.created_at);
    const keep = new Set<string>();
    for (const t of tasks.slice(0, MAX_ORG_TASKS_PER_ORG)) {
      keep.add(t.id);
    }
    for (const t of tasks) {
      if (keep.has(t.id)) {
        continue;
      }
      if (!TERMINAL_STATUSES.has(t.status)) {
        // Running task — skip eviction (it still counts toward the cap,
        // which means we'll evict more terminal ones to compensate).
        continue;
      }
      removeHostDir(t);
      appState.organizationTasks.delete(t.id);
      evictedAny = true;
    }
  }

  if (evictedAny) {
    persist();
  }
}

/** Best-effort removal of the host directory for a task. */
function removeHostDir(task: OrgTask): void {
  const dir = orgHostDir(task.organization_id, task.id);
  try {
    fs.rmSync(dir, { force: true, recursive: true });
  } catch (e) {
    info(`org-task ${task.id}: remove host dir failed: ${String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function listOrgTasks(organizationId?: string): OrgTask[] {
  const all = [...appState.organizationTasks.values()];
  const filtered = organizationId
    ? all.filter((t) => t.organization_id === organizationId)
    : all;

  return filtered.sort((a, b) => b.created_at - a.created_at);
}

export function getOrgTask(id: string): OrgTask | null {
  return appState.organizationTasks.get(id) ?? null;
}

/** Find the OrgTask (if any) whose host session matches `sessionId`. */
export function findOrgTaskForSession(sessionId: string): OrgTask | null {
  for (const t of appState.organizationTasks.values()) {
    if (t.host_session_id === sessionId) {
      return t;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateOrgTaskInput {
  organization_id: string;
  title: string;
  prompt: string;
  scope: { repo_root: string; role: string }[];
}

export function createOrgTask(input: CreateOrgTaskInput): OrgTask {
  const now = Date.now();
  const task: OrgTask = {
    id: crypto.randomUUID(),
    organization_id: input.organization_id,
    title: input.title,
    prompt: input.prompt,
    status: "running",
    created_at: now,
    updated_at: now,
    host_session_id: null,
    host_agent_id: null,
    scope: input.scope.map((s) => ({
      repo_root: s.repo_root,
      role: s.role,
    })),
  };

  appState.organizationTasks.set(task.id, task);
  persist();
  enforceRetention();

  return task;
}

export function updateOrgTask(
  taskId: string,
  patch: Partial<OrgTask>,
): OrgTask {
  const task = appState.organizationTasks.get(taskId);
  if (!task) {
    throw `OrgTask not found: ${taskId}`;
  }
  const updated: OrgTask = { ...task, ...patch, updated_at: Date.now() };
  appState.organizationTasks.set(taskId, updated);
  persist();

  return updated;
}

export function deleteOrgTask(taskId: string): void {
  const task = appState.organizationTasks.get(taskId);
  if (!task) {
    throw `OrgTask not found: ${taskId}`;
  }
  removeHostDir(task);
  appState.organizationTasks.delete(taskId);
  persist();
}

/**
 * Remove every task belonging to the organization and its top-level host dir.
 * Called from organization deletion to cascade cleanup.
 */
export function deleteOrgTasksForOrganization(organizationId: string): void {
  const toDelete: string[] = [];
  for (const t of appState.organizationTasks.values()) {
    if (t.organization_id === organizationId) {
      toDelete.push(t.id);
    }
  }
  for (const id of toDelete) {
    appState.organizationTasks.delete(id);
  }
  const orgDir = orgHostOrgDir(organizationId);
  try {
    fs.rmSync(orgDir, { force: true, recursive: true });
  } catch (e) {
    warn(`Failed to remove org host dir ${orgDir}: ${String(e)}`);
  }
  if (toDelete.length > 0) {
    persist();
  }
}
