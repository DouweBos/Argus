/**
 * Orchestration layer for cross-repo OrgTasks.
 *
 * Spawns a single "host" agent in a neutral workspace (a plain directory at
 * `~/.argus/org-hosts/{orgId}/{taskId}/`). The host agent has access to every
 * scope repo via the Argus MCP tools and can spawn per-repo child agents on
 * demand when work is genuinely parallel.
 */

import type { OrgTask, OrgTaskScopeEntry, StartOrgTaskInput } from "./models";
import fs from "node:fs";
import { error, info } from "../../../app/lib/logger";
import { appState } from "../../state";
import { sendAgentMessage, startAgent, stopAgent } from "../agent/claude";
import { ensureRepoRegistered } from "../mcp/projects";
import { createOrgHostWorkspace } from "../workspace/manager";
import { createOrgTask, updateOrgTask } from "./manager";
import { orgHostDir } from "./paths";

/**
 * Start a new OrgTask. Creates one neutral host workspace + agent. Returns
 * immediately once the task record exists; workspace/agent creation happens
 * asynchronously and state updates are emitted via the
 * `organization_tasks:changed` event.
 */
export async function startOrgTask(input: StartOrgTaskInput): Promise<OrgTask> {
  const title = input.title.trim();
  const prompt = input.prompt.trim();
  if (!title) {
    throw "Task title is required.";
  }
  if (!prompt) {
    throw "Task prompt is required.";
  }

  const org = appState.organizations.get(input.organizationId);
  if (!org) {
    throw `Organization not found: ${input.organizationId}`;
  }

  if (input.scope.length === 0) {
    throw "Select at least one repo for scope.";
  }

  // Validate scope entries against the org and snapshot roles.
  const scope: OrgTaskScopeEntry[] = input.scope.map((s) => {
    const orgMember = org.members.find((om) => om.repo_root === s.repo_root);
    if (!orgMember) {
      throw `Repo is not a member of ${org.name}: ${s.repo_root}`;
    }

    return { repo_root: s.repo_root, role: orgMember.role };
  });

  const task = createOrgTask({
    organization_id: input.organizationId,
    title,
    prompt,
    scope,
  });

  // Spawn the host asynchronously — the UI can show "initializing" state
  // while the workspace + agent come up.
  spawnHost(task.id).catch((e: unknown) => {
    const msg = typeof e === "string" ? e : String(e);
    error(`org-task ${task.id}: host spawn failed: ${msg}`);
    updateOrgTask(task.id, { status: "failed" });
  });

  return task;
}

async function spawnHost(taskId: string): Promise<void> {
  const task = appState.organizationTasks.get(taskId);
  if (!task) {
    throw `OrgTask not found: ${taskId}`;
  }

  // Register every scope repo so MCP tools surface them to the host agent.
  for (const entry of task.scope) {
    try {
      ensureRepoRegistered(entry.repo_root);
    } catch (e) {
      info(
        `org-task ${taskId}: could not register ${entry.repo_root}: ${String(e)}`,
      );
    }
  }

  // Create the neutral host workspace.
  const workspace = await createOrgHostWorkspace({
    organizationId: task.organization_id,
    taskId,
    displayName: task.title,
  });

  const ws = appState.workspaces.get(workspace.id);
  if (ws) {
    ws.organization_task_id = taskId;
    appState.workspaces.set(workspace.id, ws);
  }

  updateOrgTask(taskId, { host_workspace_id: workspace.id });

  // Spawn the agent.
  const agentInfo = await startAgent(workspace.id);
  updateOrgTask(taskId, { host_agent_id: agentInfo.agent_id });

  // Deliver the shared prompt + org context as the first user message.
  const org = appState.organizations.get(task.organization_id);
  const orgName = org?.name ?? "(unknown org)";

  const scopeLines = task.scope
    .map((s) => `- \`${s.repo_root}\` — ${s.role || "(no role)"}`)
    .join("\n");

  const combined = [
    task.prompt,
    "",
    "---",
    "",
    "## Organization context",
    "",
    `You are hosting a cross-repo task for **${orgName}**. These repos are in scope:`,
    "",
    scopeLines,
    "",
    "You are running in a neutral workspace that is not a worktree of any scope repo. The repos above are available via the Argus MCP tools — you can read and edit their files directly at their absolute paths for simple or sequential work. When a change is genuinely parallelizable, call `spawn_agent` or `spawn_agents_batch` with the target `repo_root` to do the work in an isolated worktree.",
  ].join("\n");

  try {
    sendAgentMessage(agentInfo.agent_id, combined);
  } catch (e) {
    info(`org-task ${taskId}: initial send failed: ${String(e)}`);
  }
}

/**
 * Cancel an OrgTask: stop the host agent and mark the task `cancelled`.
 * Child agents spawned via MCP are independent — users cancel those via the
 * normal workspace UI.
 */
export async function cancelOrgTask(taskId: string): Promise<OrgTask> {
  const task = appState.organizationTasks.get(taskId);
  if (!task) {
    throw `OrgTask not found: ${taskId}`;
  }

  if (task.host_agent_id) {
    const session = appState.agents.get(task.host_agent_id);
    if (session && session.status !== "stopped" && session.status !== "error") {
      try {
        await stopAgent(task.host_agent_id);
      } catch (e) {
        info(
          `org-task ${taskId}: stop host agent ${task.host_agent_id} failed: ${String(e)}`,
        );
      }
    }
  }

  return updateOrgTask(taskId, { status: "cancelled" });
}

/**
 * Remove the host directory from disk. Called when a task is explicitly
 * deleted (retention cleanup handles this inline via manager.ts).
 */
export function removeHostDirectory(
  organizationId: string,
  taskId: string,
): void {
  const dir = orgHostDir(organizationId, taskId);
  try {
    fs.rmSync(dir, { force: true, recursive: true });
  } catch (e) {
    info(`org-task ${taskId}: remove host dir failed: ${String(e)}`);
  }
}
