import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "@argus/peacock";
import { listen } from "../../../lib/events";
import {
  appCancelQuit,
  appConfirmQuit,
  type QuitRequestPayload,
} from "../../../lib/ipc";

/**
 * Listens for `app:quit-request` from the main process and surfaces a
 * confirm dialog when agents are still running. Accepting calls back into
 * `app_confirm_quit`, which stops the agents and re-triggers `app.quit()`.
 */
export function QuitGuard() {
  const [runningCount, setRunningCount] = useState<number | null>(null);

  useEffect(() => {
    const unlistenPromise = listen<QuitRequestPayload>(
      "app:quit-request",
      (event) => {
        setRunningCount(event.payload.runningCount);
      },
    );

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  if (runningCount === null) {
    return null;
  }

  const handleCancel = () => {
    setRunningCount(null);
    appCancelQuit().catch(() => {});
  };

  const handleConfirm = async () => {
    setRunningCount(null);
    try {
      await appConfirmQuit();
    } catch {
      // Swallow — if the backend throws, the app just stays open.
    }
  };

  const label =
    runningCount === 1 ? "1 agent is" : `${runningCount} agents are`;

  return createPortal(
    <ConfirmDialog
      title="Quit Argus?"
      titleId="confirm-quit-argus"
      destructive
      cancelLabel="Cancel"
      confirmLabel="Quit anyway"
      onCancel={handleCancel}
      onConfirm={handleConfirm}
    >
      {label} still running. Quitting will stop{" "}
      {runningCount === 1 ? "it" : "them"}.
    </ConfirmDialog>,
    document.body,
  );
}
