import { useEffect, useReducer } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "@argus/peacock";
import { stopAgentById } from "../../../lib/agentEventService";
import { getPending, setPending, subscribe } from "./stopAgentRequest";

/**
 * Renderer component for the confirm dialog. Mount once at the app root so
 * any call to `requestStopAgent` can surface its dialog.
 */
export function StopAgentGuard() {
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  useEffect(() => subscribe(forceUpdate), []);

  const pending = getPending();
  if (!pending) {
    return null;
  }

  const { agentId, onAfterStop } = pending;

  const handleCancel = () => {
    setPending(null);
  };

  const handleConfirm = async () => {
    try {
      await stopAgentById(agentId);
    } catch {
      // Swallow — the caller either observes the status change or doesn't.
    }
    setPending(null);
    onAfterStop?.();
  };

  return createPortal(
    <ConfirmDialog
      title="Stop running agent?"
      titleId="confirm-stop-agent"
      destructive
      cancelLabel="Cancel"
      confirmLabel="Stop & close"
      onCancel={handleCancel}
      onConfirm={handleConfirm}
    >
      This agent is still running. Stop it and close anyway?
    </ConfirmDialog>,
    document.body,
  );
}
