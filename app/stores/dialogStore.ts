import { create } from "zustand";
import { getSessionState } from "./sessionStore";

/**
 * `null` → dialog hidden. `{ mode: "create" }` → create form. `{ mode: "edit", id }`
 * → edit form pre-populated from the org with that id.
 */
export type OrganizationDialogState =
  | { id: string; mode: "edit" }
  | { mode: "create" }
  | null;

interface DialogState {
  /** Shows the CreateSessionDialog rooted at this repo path when non-null. */
  createSessionRepoRoot: string | null;
  /** Shows the NewSessionPicker (repo chooser) when true. */
  newSessionPickerOpen: boolean;
  openProjectVisible: boolean;
  organizationDialog: OrganizationDialogState;
}

const store = create<DialogState>(() => ({
  openProjectVisible: false,
  newSessionPickerOpen: false,
  createSessionRepoRoot: null,
  organizationDialog: null,
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

export const showCreateOrganizationDialog = () =>
  store.setState({ organizationDialog: { mode: "create" } });
export const showEditOrganizationDialog = (id: string) =>
  store.setState({ organizationDialog: { mode: "edit", id } });
export const hideOrganizationDialog = () =>
  store.setState({ organizationDialog: null });
export const useOrganizationDialog = () => store((s) => s.organizationDialog);
