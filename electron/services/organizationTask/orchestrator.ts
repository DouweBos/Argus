/**
 * Orchestration layer for cross-repo OrgTasks.
 *
 * Given a selection of org members, creates a workspace in each, spawns a
 * Claude agent in each, and updates OrgTask state as the pieces come up. The
 * shared prompt (plus any per-member addendum) is passed as the first user
 * message to every agent.
 */

import type { OrgTask, StartOrgTaskInput } from "./models";
import { error, info } from "../../../app/lib/logger";
import { appState } from "../../state";
import { sendAgentMessage, startAgent, stopAgent } from "../agent/claude";
import { createWorkspace } from "../workspace/manager";
import { loadMetadata, saveMetadata } from "../workspace/metadata";
import { titleToBranchSlug, worktreesRoot } from "../workspace/git";
import { createOrgTask, updateOrgTask, updateOrgTaskMember } from "./manager";

/**
 * Start a new OrgTask. Creates one workspace + agent per selected member in
 * parallel. Returns immediately once the task record exists; workspace/agent
 * creation happens asynchronously and state updates are emitted via the
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

  if (input.members.length === 0) {
    throw "Select at least one member repo.";
  }

  // Validate members and look up their role at start time.
  const members = input.members.map((m) => {
    const orgMember = org.members.find((om) => om.repo_root === m.repo_root);
    if (!orgMember) {
      throw `Repo is not a member of ${org.name}: ${m.repo_root}`;
    }

    return {
      repo_root: m.repo_root,
      role: orgMember.role,
      addendum: (m.addendum ?? "").trim(),
    };
  });

  const task = createOrgTask({
    organization_id: input.organizationId,
    title,
    prompt,
    members,
  });

  // Short suffix to keep branch names unique across tasks with the same title.
  const shortId = task.id.slice(0, 6);
  const slugBase = titleToBranchSlug(title);
  const branchName = `org-task/${slugBase}-${shortId}`;

  // Fan out — each member runs independently.
  void Promise.all(
    members.map(async (m) => {
      try {
        await spawnForMember(task.id, m.repo_root, m.addendum, branchName);
      } catch (e) {
        const msg = typeof e === "string" ? e : String(e);
        error(`org-task ${task.id}: member ${m.repo_root} failed: ${msg}`);
        updateOrgTaskMember(task.id, m.repo_root, { status: "failed" });
      }
    }),
  ).then(() => {
    const current = appState.organizationTasks.get(task.id);
    if (!current) {
      return;
    }
    const allFailed = current.members.every((mm) => mm.status === "failed");
    if (allFailed) {
      updateOrgTask(task.id, { status: "failed" });
    }
  });

  return task;
}

async function spawnForMember(
  taskId: string,
  repoRoot: string,
  addendum: string,
  branchName: string,
): Promise<void> {
  const task = appState.organizationTasks.get(taskId);
  if (!task) {
    throw `OrgTask not found: ${taskId}`;
  }

  // Create the workspace (one per member, each in its own repo).
  const description = `Org task: ${task.title}`;
  const workspace = await createWorkspace(
    repoRoot,
    branchName,
    description,
    false,
    undefined,
  );

  // Link the workspace back to this task + persist.
  const ws = appState.workspaces.get(workspace.id);
  if (ws) {
    ws.organization_task_id = taskId;
    appState.workspaces.set(workspace.id, ws);
    if (ws.kind === "worktree") {
      const root = worktreesRoot(repoRoot);
      try {
        const meta = loadMetadata(root);
        meta.set(ws.path, {
          id: ws.id,
          display_name: ws.display_name,
          description: ws.description,
          base_branch: ws.base_branch,
          organization_task_id: taskId,
        });
        saveMetadata(root, meta);
      } catch (e) {
        info(`org-task ${taskId}: metadata save failed: ${String(e)}`);
      }
    }
  }

  updateOrgTaskMember(taskId, repoRoot, {
    workspace_id: workspace.id,
    status: "running",
  });

  // Spawn the agent in the new workspace.
  const agentInfo = await startAgent(workspace.id);
  updateOrgTaskMember(taskId, repoRoot, { agent_id: agentInfo.agent_id });

  // Deliver the shared prompt as the first user message.
  const combined = addendum
    ? `${task.prompt}\n\n---\n\n${addendum}`
    : task.prompt;
  try {
    sendAgentMessage(agentInfo.agent_id, combined);
  } catch (e) {
    info(`org-task ${taskId}: initial send failed: ${String(e)}`);
  }
}

/**
 * Cancel an OrgTask: stop every still-running member agent and mark the task
 * `cancelled`. Workspace artifacts are left in place so the user can still
 * inspect/merge partial work.
 */
export async function cancelOrgTask(taskId: string): Promise<OrgTask> {
  const task = appState.organizationTasks.get(taskId);
  if (!task) {
    throw `OrgTask not found: ${taskId}`;
  }

  for (const m of task.members) {
    if (!m.agent_id) {
      continue;
    }
    const session = appState.agents.get(m.agent_id);
    if (session && session.status !== "stopped" && session.status !== "error") {
      try {
        await stopAgent(m.agent_id);
      } catch (e) {
        info(
          `org-task ${taskId}: stop agent ${m.agent_id} failed: ${String(e)}`,
        );
      }
    }
    updateOrgTaskMember(taskId, m.repo_root, { status: "completed" });
  }

  return updateOrgTask(taskId, { status: "cancelled" });
}
