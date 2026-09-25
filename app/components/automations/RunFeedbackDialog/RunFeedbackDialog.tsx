import { useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  FormField,
  TextArea,
  Toggle,
} from "@argus/peacock";
import { sendAutomationRunFeedback } from "../../../stores/automationStore";
import styles from "./RunFeedbackDialog.module.css";

const TITLE_ID = "run-feedback-title";

const PLACEHOLDER =
  "The flaky snapshot test isn't a nice-to-have — it's been failing every morning for a week.";

/**
 * Arguing with a report. The note goes to the run's own agent, which is picked
 * back up where it stopped and rewrites the report around it.
 *
 * The toggle is the whole safety story: by default feedback only ever adds
 * proposals, so disagreeing about one thing cannot quietly empty the inbox of
 * everything else. Turning it on is the user saying "yes, take that one out".
 */
export function RunFeedbackDialog({
  runId,
  onClose,
}: {
  onClose: () => void;
  runId: string;
}) {
  const [note, setNote] = useState("");
  const [allowClearing, setAllowClearing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await sendAutomationRunFeedback({ runId, note, allowClearing });
      onClose();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
      setSending(false);
    }
  };

  return (
    <Dialog
      title="Give feedback on this report"
      titleId={TITLE_ID}
      size="medium"
      onClose={onClose}
    >
      <DialogBody>
        <FormField
          label="What did it get wrong?"
          helper="The run's agent picks up where it left off, checks what it claimed, and publishes a corrected report."
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
          label="Let it remove proposals"
          helper="Off, feedback can only add to the inbox. Turn it on only if you are asking for something in there to go."
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
        <Button variant="ghost" disabled={sending} onClick={onClose}>
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
