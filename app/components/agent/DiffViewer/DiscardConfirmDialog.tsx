/**
 * DiscardConfirmDialog — destructive-confirm dialogs for file discard / untrack.
 *
 * Extracted from DiffViewer to keep that file under 500 lines.
 */
import { DestructiveConfirm } from "@argus/peacock";
import { gitDiscardFile, gitUntrackFile } from "../../../lib/ipc";
import { setConfirmPreference } from "../../../stores/settingsStore";

export interface DiscardConfirmState {
  kind: "discard" | "untrack";
  paths: string[];
}

export interface DiscardConfirmDialogProps {
  onAction: (action: () => Promise<void>) => Promise<void>;
  onClose: () => void;
  sessionId: string;
  state: DiscardConfirmState | null;
}

function confirmTitle(state: DiscardConfirmState): string {
  const n = state.paths.length;
  if (state.kind === "discard") {
    return n > 1 ? `Discard ${n} files?` : "Discard file?";
  }

  return n > 1 ? `Stop tracking ${n} files?` : "Stop tracking file?";
}

export function DiscardConfirmDialog({
  state,
  sessionId,
  onAction,
  onClose,
}: DiscardConfirmDialogProps) {
  if (!state) {
    return null;
  }

  return (
    <DestructiveConfirm
      open
      tone="destructive"
      title={confirmTitle(state)}
      description={
        state.kind === "discard"
          ? "All uncommitted changes to the selected files will be lost. This cannot be undone."
          : "These files will be removed from the index but kept on disk. They will appear as untracked."
      }
      confirmLabel={state.kind === "discard" ? "Discard" : "Stop tracking"}
      rememberKey={state.kind === "discard" ? "discard-file" : "untrack-file"}
      rememberLabel={
        state.kind === "discard" ? "discarding files" : "stopping tracking"
      }
      onCancel={onClose}
      onConfirm={(skip) => {
        if (skip) {
          setConfirmPreference(
            state.kind === "discard" ? "discard-file" : "untrack-file",
            true,
          );
        }
        const paths = state.paths;
        const kind = state.kind;
        onClose();
        onAction(async () => {
          for (const p of paths) {
            if (kind === "discard") {
              await gitDiscardFile(sessionId, p);
            } else {
              await gitUntrackFile(sessionId, p);
            }
          }
        });
      }}
    />
  );
}
