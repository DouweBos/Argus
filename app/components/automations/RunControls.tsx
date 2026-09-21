/**
 * Shared run controls. `runAutomationNow` resolves as soon as the record
 * exists, so these never wait for the run to finish — progress arrives on
 * `automation_run:changed` and re-renders whatever is on screen.
 */

import type { AutomationRunStatus } from "../../lib/types";
import { useState } from "react";
import { Badge, Button, DestructiveConfirm } from "@argus/peacock";
import { runStatusTone } from "../../lib/automations";
import {
  cancelAutomationRun,
  deleteAutomationRun,
  runAutomationNow,
  useHasActiveRun,
} from "../../stores/automationStore";

export function RunStatusBadge({ status }: { status: AutomationRunStatus }) {
  return <Badge tone={runStatusTone(status)}>{status}</Badge>;
}

interface TriggerButtonProps {
  automationId: string;
  size?: "md" | "sm";
}

/**
 * Fire an automation. Disabled while a run is in flight — a second trigger is
 * recorded as a skipped run by the host, which is not what the click meant.
 */
export function TriggerRunButton({
  automationId,
  size = "sm",
}: TriggerButtonProps) {
  const active = useHasActiveRun(automationId);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await runAutomationNow(automationId);
    } catch {
      // The failure surfaces as a failed run record.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size={size}
      variant="secondary"
      disabled={active || busy}
      title={active ? "A run is already in progress" : "Run now"}
      onClick={() => {
        run().catch(() => undefined);
      }}
    >
      {active ? "Running…" : "Run now"}
    </Button>
  );
}

interface CancelButtonProps {
  runId: string;
  size?: "md" | "sm";
}

export function CancelRunButton({ runId, size = "sm" }: CancelButtonProps) {
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelAutomationRun(runId);
    } catch {
      // Already finished — the next event settles the row.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size={size}
      variant="danger"
      disabled={busy}
      onClick={() => {
        cancel().catch(() => undefined);
      }}
    >
      Cancel
    </Button>
  );
}

interface DeleteButtonProps {
  /** Where to go once the run is gone. Rows stay put; the run screen leaves. */
  onDeleted?: () => void;
  runId: string;
  size?: "md" | "sm";
}

/**
 * Throw a run away for good — the record, its report and the proposals it
 * raised. Confirmed every time: unlike dismissing, nothing is recoverable.
 */
export function DeleteRunButton({
  onDeleted,
  runId,
  size = "sm",
}: DeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await deleteAutomationRun(runId);
      onDeleted?.();
    } catch {
      // The host kept it — the list still says so.
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <Button
        disabled={busy}
        onClick={() => setConfirming(true)}
        size={size}
        variant="ghost"
      >
        Delete
      </Button>
      <DestructiveConfirm
        cancelLabel="Keep it"
        confirmLabel="Delete run"
        description="The run, its report and any proposals it raised are removed. This cannot be undone."
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          remove().catch(() => undefined);
        }}
        open={confirming}
        title="Delete this run?"
      />
    </>
  );
}
