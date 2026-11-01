import { describeError } from "@argus/client-core";
import { useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import { FormField } from "../FormField/FormField";
import { TextArea } from "../Input/Input";
import { Toggle } from "../Toggle/Toggle";
import styles from "./RunFeedbackDialog.module.css";

const TITLE_ID = "run-feedback-title";

const PLACEHOLDER =
  "The flaky snapshot test isn't a nice-to-have — it's been failing every morning for a week.";

export interface RunFeedbackDialogProps {
  onClose: () => void;
  /** Rejects with what the computer said; the dialog shows it and stays open. */
  onSend: (note: string, allowClearing: boolean) => Promise<unknown>;
}

/**
 * Arguing with a report. The note goes to the run's own agent, which is picked
 * back up where it stopped and rewrites the report around it.
 *
 * The toggle is the whole safety story: by default feedback only ever adds
 * proposals, so disagreeing about one thing cannot quietly empty the inbox of
 * everything else.
 */
export function RunFeedbackDialog({ onClose, onSend }: RunFeedbackDialogProps) {
  const [note, setNote] = useState("");
  const [allowClearing, setAllowClearing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await onSend(note.trim(), allowClearing);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setSending(false);
    }
  };

  return (
    <Dialog
      size="medium"
      title="Give feedback on this report"
      titleId={TITLE_ID}
      onClose={onClose}
    >
      <DialogBody>
        <FormField
          helper="The run's agent picks up where it left off, checks what it claimed, and publishes a corrected report."
          label="What did it get wrong?"
        >
          <TextArea
            autoFocus
            className={styles.note}
            placeholder={PLACEHOLDER}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>

        <FormField
          helper="Off, feedback can only add to the inbox. Turn it on only if you are asking for something in there to go."
          label="Let it remove proposals"
        >
          <Toggle checked={allowClearing} onChange={setAllowClearing}>
            {allowClearing
              ? "It may withdraw or supersede what your note names"
              : "Proposals already in the inbox stay"}
          </Toggle>
        </FormField>

        {error && <p className={styles.error}>{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button disabled={sending} variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={sending || note.trim().length === 0}
          onClick={() => {
            send().catch(() => undefined);
          }}
        >
          {sending ? "Sending…" : "Send feedback"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
