/**
 * "Save as an automation" — the bridge that makes a one-off the authoring path
 * rather than a dead end.
 *
 * The playbook and scope come from the run itself, so nothing is retyped. It
 * lands paused and manual: the run you did by hand must not become a clock you
 * did not ask for.
 */

import { useState } from "react";
import { Button, Icons } from "@argus/peacock";
import {
  openAutomation,
  saveScratchRunAsAutomation,
} from "../../stores/automationStore";

export function SaveQuickRunButton({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const automation = await saveScratchRunAsAutomation(runId);
      openAutomation(automation.id);
    } catch {
      // The only failure is a run the host has already swept; the empty state
      // on the automation screen covers it.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      leading={<Icons.PlusIcon size={11} />}
      title="Create an automation from this run's playbook and scope"
      onClick={() => {
        save().catch(() => undefined);
      }}
    >
      {busy ? "Saving…" : "Save as automation"}
    </Button>
  );
}
