/**
 * Orchestration layer for cross-repo OrgTasks.
 *
 * Spawns a single "host" agent in a neutral session (a plain directory at
 * `~/.argus/org-hosts/{orgId}/{taskId}/`). The host agent has access to every
 * scope repo via the Argus MCP tools and can spawn per-repo child agents on
 * demand when work is genuinely parallel.
 */

import type { OrgTask, OrgTaskScopeEntry, StartOrgTaskInput } from "./models";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { error, info } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { sendAgentMessage, startAgent, stopAgent } from "../agent/claude";
import { ensureRepoRegistered } from "../mcp/projects";
import { createOrgHostSession } from "../session/manager";
import { createOrgTask, updateOrgTask } from "./manager";
import { orgHostDir } from "./paths";

const execFileAsync = promisify(execFile);

/**
 * Start a new OrgTask. Creates one neutral host session + agent. Returns
 * immediately once the task record exists; session/agent creation happens
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
  // while the session + agent come up.
  spawnHost(task.id).catch((e: unknown) => {
    const msg = typeof e === "string" ? e : String(e);
    error(`org-task ${task.id}: host spawn failed: ${msg}`);
    updateOrgTask(task.id, { status: "failed", error: msg });
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

  // Create the neutral host session.
  const session = await createOrgHostSession({
    organizationId: task.organization_id,
    taskId,
    displayName: task.title,
  });

  const ws = appState.sessions.get(session.id);
  if (ws) {
    ws.organization_task_id = taskId;
    appState.sessions.set(session.id, ws);
  }

  updateOrgTask(taskId, { host_session_id: session.id });

  // Spawn the agent.
  const agentInfo = await startAgent(session.id);
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
    "You are running in a neutral session that is not a worktree of any scope repo. The repos above are available via the Argus MCP tools — you can read and edit their files directly at their absolute paths for simple or sequential work. When a change is genuinely parallelizable, call `spawn_agent` or `spawn_agents_batch` with the target `repo_root` to do the work in an isolated worktree.",
  ].join("\n");

  // Notify the renderer so the agent store registers this agent and its
  // event channels get subscribed — without this event, `startAgent` called
  // directly from the backend stays invisible to the UI and the session
  // view falls back to the "Start agent" home panel.
  getMainWindow()?.webContents.send("agent:started", {
    agent_id: agentInfo.agent_id,
    session_id: agentInfo.session_id,
    status: agentInfo.status,
    permission_mode: undefined,
    parent_agent_id: agentInfo.parent_agent_id,
    initial_prompt: combined,
  });

  try {
    sendAgentMessage(agentInfo.agent_id, combined);
  } catch (e) {
    const msg = typeof e === "string" ? e : String(e);
    error(`org-task ${taskId}: initial send failed: ${msg}`);
    updateOrgTask(taskId, {
      status: "failed",
      error: `Failed to deliver initial prompt to host agent: ${msg}`,
    });

    return;
  }

  // Generate a concise task title in the background. Best-effort — if
  // `claude -p` fails or times out, we leave the user-provided title.
  generateTaskTitle(taskId, task.prompt, task.scope).catch((e: unknown) => {
    info(`org-task ${taskId}: title generation failed: ${String(e)}`);
  });
}

async function generateTaskTitle(
  taskId: string,
  prompt: string,
  scope: OrgTaskScopeEntry[],
): Promise<void> {
  const scopeNames = scope
    .map((s) => s.repo_root.split("/").filter(Boolean).pop() ?? s.repo_root)
    .join(", ");
  const metaPrompt = [
    "Generate a concise 3-7 word title for this cross-repo task. Return only the title text — no quotes, no punctuation at the end, no preamble.",
    "",
    `Repos in scope: ${scopeNames}`,
    "",
    "Task:",
    prompt,
  ].join("\n");

  const { stdout } = await execFileAsync("claude", ["-p", metaPrompt], {
    timeout: 30_000,
    maxBuffer: 64 * 1024,
  });
  const title = stdout
    .trim()
    .replace(/^["']|["']$/g, "")
    .slice(0, 80);
  if (!title) {
    return;
  }
  const current = appState.organizationTasks.get(taskId);
  if (!current) {
    return;
  }
  updateOrgTask(taskId, { title });
}

/**
 * Cancel an OrgTask: stop the host agent and mark the task `cancelled`.
 * Child agents spawned via MCP are independent — users cancel those via the
 * normal session UI.
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
