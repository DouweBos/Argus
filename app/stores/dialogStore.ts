import { create } from "zustand";
import { getWorkspaceState } from "./workspaceStore";

interface DialogState {
  /** Shows the CreateWorkspaceDialog rooted at this repo path when non-null. */
  createWorkspaceRepoRoot: string | null;
  /** Shows the NewWorkspacePicker (repo chooser) when true. */
  newWorkspacePickerOpen: boolean;
  openProjectVisible: boolean;
}

const store = create<DialogState>(() => ({
  openProjectVisible: false,
  newWorkspacePickerOpen: false,
  createWorkspaceRepoRoot: null,
}));

export const showOpenProjectDialog = () =>
  store.setState({ openProjectVisible: true });
export const hideOpenProjectDialog = () =>
  store.setState({ openProjectVisible: false });

export const showNewWorkspacePicker = () =>
  store.setState({ newWorkspacePickerOpen: true });
export const hideNewWorkspacePicker = () =>
  store.setState({ newWorkspacePickerOpen: false });

export const showCreateWorkspaceDialog = (repoRoot: string) =>
  store.setState({ createWorkspaceRepoRoot: repoRoot });
export const hideCreateWorkspaceDialog = () =>
  store.setState({ createWorkspaceRepoRoot: null });

/**
 * Smart "new workspace" trigger: routes to the right dialog based on how many
 * projects are open. With 0 projects we need a repo first; with 1 we skip the
 * picker; with 2+ we show the picker.
 */
export const triggerNewWorkspace = () => {
  const { projects } = getWorkspaceState();
  if (projects.length === 0) {
    store.setState({ openProjectVisible: true });

    return;
  }
  if (projects.length === 1) {
    const only = projects[0];
    if (only) {
      store.setState({ createWorkspaceRepoRoot: only.repoRoot });
    }

    return;
  }
  store.setState({ newWorkspacePickerOpen: true });
};

export const useOpenProjectVisible = () => store((s) => s.openProjectVisible);
export const useNewWorkspacePickerOpen = () =>
  store((s) => s.newWorkspacePickerOpen);
export const useCreateWorkspaceRepoRoot = () =>
  store((s) => s.createWorkspaceRepoRoot);
