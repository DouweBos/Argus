import { create } from "zustand";
import { getSessionState } from "./sessionStore";

interface DialogState {
  /** Shows the CreateSessionDialog rooted at this repo path when non-null. */
  createSessionRepoRoot: string | null;
  /** Shows the NewSessionPicker (repo chooser) when true. */
  newSessionPickerOpen: boolean;
  openProjectVisible: boolean;
}

const store = create<DialogState>(() => ({
  openProjectVisible: false,
  newSessionPickerOpen: false,
  createSessionRepoRoot: null,
}));

export const showOpenProjectDialog = () =>
  store.setState({ openProjectVisible: true });
export const hideOpenProjectDialog = () =>
  store.setState({ openProjectVisible: false });

export const showNewSessionPicker = () =>
  store.setState({ newSessionPickerOpen: true });
export const hideNewSessionPicker = () =>
  store.setState({ newSessionPickerOpen: false });

export const showCreateSessionDialog = (repoRoot: string) =>
  store.setState({ createSessionRepoRoot: repoRoot });
export const hideCreateSessionDialog = () =>
  store.setState({ createSessionRepoRoot: null });

/**
 * Smart "new session" trigger: routes to the right dialog based on how many
 * projects are open. With 0 projects we need a repo first; with 1 we skip the
 * picker; with 2+ we show the picker.
 */
export const triggerNewSession = () => {
  const { projects } = getSessionState();
  if (projects.length === 0) {
    store.setState({ openProjectVisible: true });

    return;
  }
  if (projects.length === 1) {
    const only = projects[0];
    if (only) {
      store.setState({ createSessionRepoRoot: only.repoRoot });
    }

    return;
  }
  store.setState({ newSessionPickerOpen: true });
};

export const useOpenProjectVisible = () => store((s) => s.openProjectVisible);
export const useNewSessionPickerOpen = () =>
  store((s) => s.newSessionPickerOpen);
export const useCreateSessionRepoRoot = () =>
  store((s) => s.createSessionRepoRoot);
