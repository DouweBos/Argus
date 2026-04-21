import type { OrgTask } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import {
  cancelOrgTask as ipcCancelOrgTask,
  deleteOrgTaskIpc,
  listOrgTasks as ipcListOrgTasks,
  startOrgTask as ipcStartOrgTask,
  type StartOrgTaskInput,
} from "../lib/ipc";

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
