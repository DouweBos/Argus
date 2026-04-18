import type { DeviceInfo, Workspace } from "./types";
import { recordActivity } from "../stores/activityStore";
import { getAgentState } from "../stores/agentStore";
import { getDevices, subscribeDevices } from "../stores/deviceStore";
import { getWorkspaceState } from "../stores/workspaceStore";
import { listen } from "./events";

let initialized = false;

interface CommitLandedPayload {
  amend: boolean;
  branch: string;
  hash: string;
  subject: string;
  workspaceId: string;
}

interface MergedPayload {
  baseBranch: string;
  branch: string;
  workspaceId: string;
}

function workspaceContext(workspaceId: string | undefined): {
  branch?: string;
  repoRoot?: string;
} {
  if (!workspaceId) {
    return {};
  }
  const ws = getWorkspaceState().workspaces.find((w) => w.id === workspaceId);

  return { repoRoot: ws?.repo_root, branch: ws?.branch };
}

/**
 * Subscribe to every backend signal that should surface on the Activity
 * screen. Safe to call more than once — only the first call takes effect.
 */
export function initActivityService(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  // Workspace lifecycle ------------------------------------------------------

  listen<Workspace>("workspace:created", (event) => {
    const ws = event.payload;
    recordActivity({
      kind: "workspace_created",
      workspaceId: ws.id,
      repoRoot: ws.repo_root,
      branch: ws.branch,
      title: "Workspace created",
      detail: ws.display_name ?? ws.branch,
    });
  });

  listen<string>("workspace:deleted", (event) => {
    const workspaceId = event.payload;
    const ws = getWorkspaceState().workspaces.find((w) => w.id === workspaceId);
    recordActivity({
      kind: "workspace_deleted",
      workspaceId,
      repoRoot: ws?.repo_root,
      branch: ws?.branch,
      title: "Workspace deleted",
      detail: ws?.display_name ?? ws?.branch,
    });
  });

  listen<MergedPayload>("workspace:merged", (event) => {
    const { workspaceId, branch, baseBranch } = event.payload;
    const { repoRoot } = workspaceContext(workspaceId);
    recordActivity({
      kind: "workspace_merged",
      workspaceId,
      repoRoot,
      branch,
      title: `Merged into ${baseBranch}`,
      detail: branch,
    });
  });

  // Commit landed ------------------------------------------------------------

  listen<CommitLandedPayload>("workspace:commit-landed", (event) => {
    const { workspaceId, branch, hash, subject, amend } = event.payload;
    const { repoRoot } = workspaceContext(workspaceId);
    recordActivity({
      kind: "commit_landed",
      workspaceId,
      repoRoot,
      branch,
      title: amend ? `Commit amended (${hash})` : `Commit ${hash}`,
      detail: subject,
    });
  });

  // Device online/offline transitions ---------------------------------------

  let previousOnline = new Map<string, boolean>(
    getDevices().map((d) => [d.deviceKey, d.online]),
  );

  subscribeDevices((devices: DeviceInfo[]) => {
    const next = new Map<string, boolean>();
    for (const d of devices) {
      next.set(d.deviceKey, d.online);
      const prev = previousOnline.get(d.deviceKey);
      if (prev === undefined || prev === d.online) {
        continue;
      }
      recordActivity({
        kind: d.online ? "device_online" : "device_offline",
        repoRoot: d.repoRoot ?? undefined,
        workspaceId: d.workspaceId ?? undefined,
        title: d.online ? "Device online" : "Device went offline",
        detail: `${d.name} · ${d.platform}`,
      });
    }
    previousOnline = next;
  });
}

/**
 * Record an agent-lifecycle event. Called from the agent event service so we
 * inherit its existing per-agent subscription lifecycle rather than
 * duplicating listeners.
 */
export function recordAgentLifecycle(
  agentId: string,
  kind: "agent_errored" | "agent_spawned" | "agent_stopped",
): void {
  const agent = getAgentState().agents[agentId];
  const workspaceId = agent?.workspace_id;
  const { repoRoot, branch } = workspaceContext(workspaceId);

  const title =
    kind === "agent_spawned"
      ? "Agent started"
      : kind === "agent_stopped"
        ? "Agent stopped"
        : "Agent errored";

  recordActivity({
    kind,
    agentId,
    workspaceId,
    repoRoot,
    branch,
    title,
  });
}
