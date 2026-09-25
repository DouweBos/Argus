import { useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  FormField,
  Spinner,
  TextArea,
} from "@argus/peacock";
import { revisePlaybook } from "../../../lib/ipc";
import styles from "./RevisePlaybookDialog.module.css";

const TITLE_ID = "revise-playbook-title";

const PLACEHOLDER =
  "Before calling a branch unshipped, check whether a merged PR already covers it.";

/**
 * "Rewrite with Claude" — an instruction in, a revised playbook out.
 *
 * The rewrite lands in the editor's draft, not on disk: the user reads the new
 * text next to the old one and presses save themselves, the same deal as
 * describing an automation from scratch.
 */
export function RevisePlaybookDialog({
  playbook,
  name,
  onApply,
  onClose,
}: {
  name?: string;
  onApply: (playbook: string) => void;
  onClose: () => void;
  playbook: string;
}) {
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  const [revised, setRevised] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revise = async () => {
    setRevising(true);
    setError(null);
    try {
      const result = await revisePlaybook({ playbook, instruction, name });
      setRevised(result.playbook);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setRevising(false);
    }
  };

  return (
    <Dialog
      title="Rewrite the playbook"
      titleId={TITLE_ID}
      size="medium"
      onClose={onClose}
    >
      <DialogBody>
        <FormField
          label="What should change?"
          helper="Claude rewrites the whole playbook and keeps the rest as it is."
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
              : "Nothing is saved until you press save in the editor."}
          </span>
          <span className={styles.spacer} />
          <Button
            size="sm"
            variant={revised ? "secondary" : "primary"}
            disabled={revising || instruction.trim().length === 0}
            onClick={() => {
              revise().catch(() => undefined);
            }}
          >
            {revised ? "Rewrite again" : "Rewrite"}
          </Button>
        </div>

        {revised !== null && (
          <FormField
            label="Revised playbook"
            helper="Edit it here if you want; applying replaces the playbook in the editor."
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
