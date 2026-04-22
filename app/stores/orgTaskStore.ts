import type { AgentStatus, OrgTask } from "../lib/types";
import type { AgentStatus as AgentPillStatus } from "@argus/peacock";
import { useEffect } from "react";
import { create } from "zustand";
import {
  cancelOrgTask as ipcCancelOrgTask,
  deleteOrgTaskIpc,
  listOrgTasks as ipcListOrgTasks,
  startOrgTask as ipcStartOrgTask,
  type StartOrgTaskInput,
} from "../lib/ipc";
import { useAgentsRecord } from "./agentStore";

/**
 * Effective UI status for a task, derived from the host agent's live state.
 * A task record stays in the "running" bucket forever after creation — the
 * host agent is what actually reflects whether work is happening right now.
 */
export function taskLiveStatus(
  task: OrgTask,
  hostAgent: AgentStatus | undefined,
): AgentPillStatus {
  if (task.status === "failed" || hostAgent?.status === "error") {
    return "error";
  }
  if (task.status === "cancelled" || task.status === "completed") {
    return "done";
  }
  if (hostAgent?.status === "running") {
    return "running";
  }
  if (hostAgent?.status === "requires_action") {
    return "pending";
  }

  return "idle";
}

/** Hook: derives live status for a task using the current agents record. */
export function useTaskLiveStatus(task: OrgTask): AgentPillStatus {
  const agents = useAgentsRecord();
  const hostAgent = task.host_agent_id ? agents[task.host_agent_id] : undefined;

  return taskLiveStatus(task, hostAgent);
}

/** Hook: returns only the tasks whose host agent is actively running. */
export function useLiveRunningOrgTasks(organizationId?: string): OrgTask[] {
  const tasks = useOrgTasks();
  const agents = useAgentsRecord();

  return tasks.filter((t) => {
    if (organizationId && t.organization_id !== organizationId) {
      return false;
    }
    const hostAgent = t.host_agent_id ? agents[t.host_agent_id] : undefined;

    return taskLiveStatus(t, hostAgent) === "running";
  });
}

interface OrgTaskStoreData {
  error: string | null;
  loading: boolean;
  tasks: OrgTask[];
}

const store = create<OrgTaskStoreData>(() => ({
  tasks: [],
  loading: false,
  error: null,
}));

export const useOrgTasks = (): OrgTask[] => store((s) => s.tasks);

export const useOrgTasksFor = (organizationId: string): OrgTask[] => {
  const tasks = useOrgTasks();

  return tasks.filter((t) => t.organization_id === organizationId);
};

/**
 * Look up the OrgTask (if any) whose host session is `sessionId`. Used by the
 * session view to decide whether to render the task banner + side panel.
 */
export const useOrgTaskForSession = (
  sessionId: string | null,
): OrgTask | null => {
  const tasks = useOrgTasks();
  if (!sessionId) {
    return null;
  }

  return tasks.find((t) => t.host_session_id === sessionId) ?? null;
};

export async function refreshOrgTasks(): Promise<void> {
  store.setState({ loading: true });
  try {
    const tasks = await ipcListOrgTasks();
    store.setState({ tasks, loading: false, error: null });
  } catch (e) {
    store.setState({
      loading: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function startOrgTask(input: StartOrgTaskInput): Promise<OrgTask> {
  const task = await ipcStartOrgTask(input);
  await refreshOrgTasks();

  return task;
}

export async function cancelOrgTask(id: string): Promise<void> {
  await ipcCancelOrgTask(id);
  await refreshOrgTasks();
}

export async function deleteOrgTask(id: string): Promise<void> {
  await deleteOrgTaskIpc(id);
  await refreshOrgTasks();
}

export function useOrgTaskSync(): void {
  useEffect(() => {
    refreshOrgTasks().catch(() => {});
    const unsub = window.argus.on<unknown>("organization_tasks:changed", () => {
      refreshOrgTasks().catch(() => {});
    });

    return () => {
      unsub();
    };
  }, []);
}
