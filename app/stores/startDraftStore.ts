import type { StartWorkspace } from "./settingsStore";
import { create } from "zustand";
import { createHeadSession } from "../lib/ipc";
import { pushError } from "./notificationsStore";
import { selectSession } from "./sessionStore";

/**
 * A request for a project's start composer to come up primed — "new session"
 * from the sidebar, the palette or a handed-off plan all land on the project's
 * home with the prompt box focused instead of opening a dialog.
 */
export interface StartDraft {
  /** Distinguishes two identical requests, so the second one still focuses. */
  nonce: number;
  prompt: string;
  repoRoot: string;
  workspace: StartWorkspace;
}

interface StartDraftState {
  draft: StartDraft | null;
}

const store = create<StartDraftState>(() => ({ draft: null }));

let nextNonce = 1;

/** Open `repoRoot`'s home with its start composer focused. */
export async function openStartDraft(
  repoRoot: string,
  options: { prompt?: string; workspace?: StartWorkspace } = {},
): Promise<void> {
  try {
    const head = await createHeadSession(repoRoot);
    store.setState({
      draft: {
        nonce: nextNonce++,
        prompt: options.prompt ?? "",
        repoRoot,
        workspace: options.workspace ?? "worktree",
      },
    });
    selectSession(head.id, "home");
  } catch (err) {
    pushError(err instanceof Error ? err.message : String(err), "start_draft");
  }
}

export const useStartDraft = (repoRoot: string | null) =>
  store((s) => (repoRoot && s.draft?.repoRoot === repoRoot ? s.draft : null));

/** The composer took the draft; a later remount must not apply it again. */
export const consumeStartDraft = (nonce: number) => {
  if (store.getState().draft?.nonce === nonce) {
    store.setState({ draft: null });
  }
};
