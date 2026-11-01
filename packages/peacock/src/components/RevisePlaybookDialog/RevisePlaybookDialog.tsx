import { describeError } from "@argus/client-core";
import { useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import { FormField } from "../FormField/FormField";
import { TextArea } from "../Input/Input";
import { Spinner } from "../Spinner/Spinner";
import styles from "./RevisePlaybookDialog.module.css";

const TITLE_ID = "revise-playbook-title";

const PLACEHOLDER =
  "Before calling a branch unshipped, check whether a merged PR already covers it.";

export interface RevisePlaybookDialogProps {
  onApply: (playbook: string) => void;
  onClose: () => void;
  /** Rewrites the playbook to the instruction; rejects with the computer's reason. */
  onRevise: (instruction: string) => Promise<string>;
}

/**
 * "Rewrite with Claude" — an instruction in, a revised playbook out.
 *
 * The rewrite lands in the editor's draft, not on disk: the user reads the new
 * text and saves it themselves, the same deal as describing an automation.
 */
export function RevisePlaybookDialog({
  onApply,
  onClose,
  onRevise,
}: RevisePlaybookDialogProps) {
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  const [revised, setRevised] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revise = async () => {
    setRevising(true);
    setError(null);
    try {
      setRevised(await onRevise(instruction.trim()));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRevising(false);
    }
  };

  return (
    <Dialog
      size="medium"
      title="Rewrite the playbook"
      titleId={TITLE_ID}
      onClose={onClose}
    >
      <DialogBody>
        <FormField
          helper="Claude rewrites the whole playbook and keeps the rest as it is."
          label="What should change?"
        >
          <TextArea
            autoFocus
            className={styles.instruction}
            placeholder={PLACEHOLDER}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </FormField>

        <div className={styles.row}>
          {revising && <Spinner size="sm" />}
          <span className={styles.hint}>
            {revising
              ? "Rewriting the playbook…"
              : "Nothing is saved until you save the automation."}
          </span>
          <span className={styles.spacer} />
          <Button
            disabled={revising || instruction.trim().length === 0}
            size="sm"
            variant={revised ? "secondary" : "primary"}
            onClick={() => {
              revise().catch(() => undefined);
            }}
          >
            {revised ? "Rewrite again" : "Rewrite"}
          </Button>
        </div>

        {revised !== null && (
          <FormField
            helper="Edit it here if you want; applying replaces the playbook in the editor."
            label="Revised playbook"
          >
            <TextArea
              mono
              className={styles.playbook}
              value={revised}
              onChange={(e) => setRevised(e.target.value)}
            />
          </FormField>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={revised === null || revised.trim().length === 0}
          onClick={() => {
            if (revised) {
              onApply(revised);
            }
            onClose();
          }}
        >
          Apply
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
