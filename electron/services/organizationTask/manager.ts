/**
 * OrgTask CRUD and lookups. Mutations persist to `organization-tasks.json`
 * and emit an `organization_tasks:changed` event to the renderer.
 */

import type { OrgTask, OrgTaskMember } from "./models";
import crypto from "node:crypto";
import { info } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { loadOrgTasks, saveOrgTasks } from "./store";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function initOrgTasks(): void {
  const tasks = loadOrgTasks();
  for (const t of tasks) {
    appState.organizationTasks.set(t.id, t);
  }
  info(`Loaded ${tasks.length} organization task(s) from disk.`);
}

function persist(): void {
  saveOrgTasks([...appState.organizationTasks.values()]);
  getMainWindow()?.webContents.send("organization_tasks:changed");
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

/** Find the OrgTask (if any) that a workspace belongs to. */
export function findOrgTaskForWorkspace(workspaceId: string): OrgTask | null {
  for (const t of appState.organizationTasks.values()) {
    if (t.members.some((m) => m.workspace_id === workspaceId)) {
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
  members: Array<{ repo_root: string; role: string; addendum: string }>;
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
    members: input.members.map((m) => ({
      repo_root: m.repo_root,
      role: m.role,
      workspace_id: null,
      agent_id: null,
      addendum: m.addendum,
      status: "pending",
    })),
  };

  appState.organizationTasks.set(task.id, task);
  persist();

  return task;
}

export function updateOrgTaskMember(
  taskId: string,
  repoRoot: string,
  patch: Partial<OrgTaskMember>,
): OrgTask {
  const task = appState.organizationTasks.get(taskId);
  if (!task) {
    throw `OrgTask not found: ${taskId}`;
  }

  const members = task.members.map((m) =>
    m.repo_root === repoRoot ? { ...m, ...patch } : m,
  );
  const updated: OrgTask = { ...task, members, updated_at: Date.now() };
  appState.organizationTasks.set(taskId, updated);
  persist();

  return updated;
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
  if (!appState.organizationTasks.delete(taskId)) {
    throw `OrgTask not found: ${taskId}`;
  }
  persist();
}
