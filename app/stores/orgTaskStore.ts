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
  activeTaskId: string | null;
  error: string | null;
  loading: boolean;
  tasks: OrgTask[];
}

const store = create<OrgTaskStoreData>(() => ({
  tasks: [],
  activeTaskId: null,
  loading: false,
  error: null,
}));

export const useOrgTasks = (): OrgTask[] => store((s) => s.tasks);

export const useOrgTasksFor = (organizationId: string): OrgTask[] => {
  const tasks = useOrgTasks();

  return tasks.filter((t) => t.organization_id === organizationId);
};

export const useActiveOrgTaskId = (): string | null =>
  store((s) => s.activeTaskId);

export const useActiveOrgTask = (): OrgTask | null => {
  const id = useActiveOrgTaskId();
  const tasks = useOrgTasks();
  if (!id) {
    return null;
  }

  return tasks.find((t) => t.id === id) ?? null;
};

export const setActiveOrgTask = (taskId: string | null): void => {
  store.setState({ activeTaskId: taskId });
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
  if (store.getState().activeTaskId === id) {
    store.setState({ activeTaskId: null });
  }
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
