import { useState } from "react";
import { Button, CalloutCard, Icons } from "@argus/peacock";
import { clearSessionSetupError, retrySessionSetup } from "../../../lib/ipc";

/** A worktree made outside Argus: run the project's setup it never got, or skip it. */
export function SetupPendingCallout({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <CalloutCard
      leading={<Icons.PlayIcon size={14} />}
      title="Setup never ran"
      meta="This worktree was made outside Argus, so the project's setup hasn't run in it."
      actions={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => retrySessionSetup(sessionId))}
          >
            Run setup
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => clearSessionSetupError(sessionId))}
          >
            Skip
          </Button>
        </>
      }
    />
  );
}
