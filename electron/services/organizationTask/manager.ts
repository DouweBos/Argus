/**
 * OrgTask CRUD and lookups. Mutations persist to `organization-tasks.json`
 * and emit an `organization_tasks:changed` event to the renderer.
 *
 * Retention: up to `MAX_ORG_TASKS_PER_ORG` terminal tasks are kept per org;
 * older ones are evicted on save and their host directories removed. Running
 * tasks are never evicted.
 */

import type { OrgTask, OrgTaskStatus } from "./models";
import crypto from "node:crypto";
import fs from "node:fs";
import { info, warn } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { orgHostDir, orgHostOrgDir } from "./paths";
import { loadOrgTasks, saveOrgTasks } from "./store";

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
  for (const t of tasks) {
    // Running tasks can't survive a restart — the host agent process is
    // gone and the neutral workspace won't be re-registered automatically.
    // Mark them as failed so the UI reflects reality.
    if (t.status === "running") {
      t.status = "failed";
      t.host_agent_id = null;
    }
    appState.organizationTasks.set(t.id, t);
  }
  info(`Loaded ${tasks.length} organization task(s) from disk.`);

  // Run retention once so legacy on-disk state self-trims on startup.
  enforceRetention();
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

/** Find the OrgTask (if any) whose host workspace matches `workspaceId`. */
export function findOrgTaskForWorkspace(workspaceId: string): OrgTask | null {
  for (const t of appState.organizationTasks.values()) {
    if (t.host_workspace_id === workspaceId) {
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
    host_workspace_id: null,
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
