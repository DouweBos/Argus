import { create } from "zustand";
import { getSessionState } from "./sessionStore";
import { openStartDraft } from "./startDraftStore";

interface DialogState {
  /** Shows the "Import projects from Claude Code" picker when true. */
  cliImportVisible: boolean;
  /** Shows the NewSessionPicker (repo chooser) when true. */
  newSessionPickerOpen: boolean;
  openProjectVisible: boolean;
}

const store = create<DialogState>(() => ({
  cliImportVisible: false,
  openProjectVisible: false,
  newSessionPickerOpen: false,
}));

export const showOpenProjectDialog = () =>
  store.setState({ openProjectVisible: true });
export const hideOpenProjectDialog = () =>
  store.setState({ openProjectVisible: false });

export const showCliImportDialog = () =>
  store.setState({ cliImportVisible: true, openProjectVisible: false });
export const hideCliImportDialog = () =>
  store.setState({ cliImportVisible: false });

export const showNewSessionPicker = () =>
  store.setState({ newSessionPickerOpen: true });
export const hideNewSessionPicker = () =>
  store.setState({ newSessionPickerOpen: false });

/**
 * Start something new in `repoRoot`: its home, with the start composer set to
 * a fresh worktree and focused. `prompt` prefills it (e.g. a handed-off plan).
 */
export const startNewSession = (repoRoot: string, prompt?: string) => {
  openStartDraft(repoRoot, { prompt, workspace: "worktree" });
};

/**
 * Smart "new session" trigger: with 0 projects we need a repo first; with 1 we
 * go straight to it; with 2+ we ask which.
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
      startNewSession(only.repoRoot);
    }

    return;
  }
  store.setState({ newSessionPickerOpen: true });
};

export const useCliImportVisible = () => store((s) => s.cliImportVisible);
export const useOpenProjectVisible = () => store((s) => s.openProjectVisible);
export const useNewSessionPickerOpen = () =>
  store((s) => s.newSessionPickerOpen);
