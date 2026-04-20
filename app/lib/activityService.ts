import type { DeviceInfo, Session } from "./types";
import { recordActivity } from "../stores/activityStore";
import { getAgentState } from "../stores/agentStore";
import { getDevices, subscribeDevices } from "../stores/deviceStore";
import { getSessionState } from "../stores/sessionStore";
import { listen } from "./events";

let initialized = false;

interface CommitLandedPayload {
  amend: boolean;
  branch: string;
  hash: string;
  sessionId: string;
  subject: string;
}

interface MergedPayload {
  baseBranch: string;
  branch: string;
  sessionId: string;
}

function sessionContext(sessionId: string | undefined): {
  branch?: string;
  repoRoot?: string;
} {
  if (!sessionId) {
    return {};
  }
  const ws = getSessionState().sessions.find((w) => w.id === sessionId);

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

  // Session lifecycle ------------------------------------------------------

  listen<Session>("session:created", (event) => {
    const ws = event.payload;
    recordActivity({
      kind: "session_created",
      sessionId: ws.id,
      repoRoot: ws.repo_root,
      branch: ws.branch,
      title: "Session created",
      detail: ws.display_name ?? ws.branch,
    });
  });

  listen<string>("session:deleted", (event) => {
    const sessionId = event.payload;
    const ws = getSessionState().sessions.find((w) => w.id === sessionId);
    recordActivity({
      kind: "session_deleted",
      sessionId,
      repoRoot: ws?.repo_root,
      branch: ws?.branch,
      title: "Session deleted",
      detail: ws?.display_name ?? ws?.branch,
    });
  });

  listen<MergedPayload>("session:merged", (event) => {
    const { sessionId, branch, baseBranch } = event.payload;
    const { repoRoot } = sessionContext(sessionId);
    recordActivity({
      kind: "session_merged",
      sessionId,
      repoRoot,
      branch,
      title: `Merged into ${baseBranch}`,
      detail: branch,
    });
  });

  // Commit landed ------------------------------------------------------------

  listen<CommitLandedPayload>("session:commit-landed", (event) => {
    const { sessionId, branch, hash, subject, amend } = event.payload;
    const { repoRoot } = sessionContext(sessionId);
    recordActivity({
      kind: "commit_landed",
      sessionId,
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
        sessionId: d.sessionId ?? undefined,
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
  const sessionId = agent?.session_id;
  const { repoRoot, branch } = sessionContext(sessionId);

  const titles: Record<typeof kind, string> = {
    agent_spawned: "Agent started",
    agent_stopped: "Agent stopped",
    agent_errored: "Agent errored",
  };
  const title = titles[kind];

  recordActivity({
    kind,
    agentId,
    sessionId,
    repoRoot,
    branch,
    title,
  });
}
