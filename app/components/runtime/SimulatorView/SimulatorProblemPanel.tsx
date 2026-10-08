import type { SimulatorProblem } from "../../../lib/types";
import { useState } from "react";
import { Button, ConfirmDialog } from "@argus/peacock";
import { deleteSimulator, eraseSimulator } from "../../../lib/ipc";
import chrome from "../RuntimeChrome.module.css";
import styles from "./RuntimeView.module.css";

interface SimulatorProblemPanelProps {
  name: string;
  /** Called once the device was erased or deleted, to reload the list. */
  onRepaired: () => void;
  problem: SimulatorProblem;
  udid: string;
}

/** A simulator that can't boot as it is, with the ways out simctl offers. */
export function SimulatorProblemPanel({
  name,
  onRepaired,
  problem,
  udid,
}: SimulatorProblemPanelProps) {
  const [confirming, setConfirming] = useState<"delete" | "erase" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (action: "delete" | "erase") => {
    setFailure(null);
    try {
      await (action === "erase" ? eraseSimulator(udid) : deleteSimulator(udid));
      setConfirming(null);
      onRepaired();
    } catch (err) {
      setConfirming(null);
      setFailure(String(err));
    }
  };

  return (
    <div className={styles.problem}>
      <p className={styles.problemMessage}>{problem.message}</p>
      <div className={styles.problemActions}>
        {problem.kind === "missing_data" && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setConfirming("erase")}
          >
            Erase
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          onClick={() => setConfirming("delete")}
        >
          Delete
        </Button>
      </div>
      {failure && <p className={chrome.phaseHint}>{failure}</p>}
      {confirming === "erase" && (
        <ConfirmDialog
          confirmLabel="Erase"
          destructive
          title={`Erase “${name}”?`}
          titleId="simulator-erase"
          onCancel={() => setConfirming(null)}
          onConfirm={() => run("erase")}
        >
          <p>
            It starts over as a fresh device: installed apps and their data are
            removed.
          </p>
        </ConfirmDialog>
      )}
      {confirming === "delete" && (
        <ConfirmDialog
          confirmLabel="Delete"
          destructive
          title={`Delete “${name}”?`}
          titleId="simulator-delete"
          onCancel={() => setConfirming(null)}
          onConfirm={() => run("delete")}
        >
          <p>The simulator and everything on it are removed from this Mac.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
