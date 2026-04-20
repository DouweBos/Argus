import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "@argus/peacock";
import { stopAgentById } from "../../../lib/agentEventService";
import { getAgentState } from "../../../stores/agentStore";

type Pending = {
  agentId: string;
  onAfterStop: (() => void) | null;
} | null;

let pending: Pending = null;
const listeners = new Set<() => void>();

function setPending(next: Pending): void {
  pending = next;
  listeners.forEach((fn) => fn());
}

/**
 * Request that an agent be stopped. If its current status is `running`, a
 * confirmation dialog is shown (rendered by {@link StopAgentGuard}); otherwise
 * the agent is stopped immediately.
 *
 * `onAfterStop` is invoked only after the stop actually happens (either the
 * immediate path or after the user confirms). It is NOT called if the user
 * cancels.
 */
export function requestStopAgent(
  agentId: string,
  onAfterStop?: () => void,
): void {
  const agent = getAgentState().agents[agentId];
  if (agent?.status === "running") {
    setPending({ agentId, onAfterStop: onAfterStop ?? null });

    return;
  }
  stopAgentById(agentId)
    .catch(() => {})
    .finally(() => onAfterStop?.());
}

/**
 * Renderer component for the confirm dialog. Mount once at the app root so
 * any call to {@link requestStopAgent} can surface its dialog.
 */
export function StopAgentGuard() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);

    return () => {
      listeners.delete(fn);
    };
  }, []);

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
