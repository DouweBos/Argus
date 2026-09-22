import { useEffect, useId, useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import styles from "./PullDialog.module.css";

export type PullStrategy = "ff-only" | "merge" | "rebase";

export interface PullDialogResult {
  strategy: PullStrategy;
  prune: boolean;
  tags: boolean;
}

export interface PullDialogProps {
  open: boolean;
  defaultStrategy?: PullStrategy;
  defaultPrune?: boolean;
  defaultTags?: boolean;
  onConfirm: (result: PullDialogResult) => void;
  onCancel: () => void;
}

const STRATEGIES: { id: PullStrategy; label: string; description: string }[] = [
  {
    id: "merge",
    label: "Merge",
    description: "Create a merge commit if histories diverge.",
  },
  {
    id: "rebase",
    label: "Rebase",
    description: "Replay your local commits on top of the remote.",
  },
  {
    id: "ff-only",
    label: "Fast-forward only",
    description: "Refuse if a merge or rebase would be required.",
  },
];

export function PullDialog({
  open,
  defaultStrategy = "merge",
  defaultPrune = false,
  defaultTags = false,
  onConfirm,
  onCancel,
}: PullDialogProps) {
  const titleId = useId();

  const [strategy, setStrategy] = useState<PullStrategy>(defaultStrategy);
  const [prune, setPrune] = useState(defaultPrune);
  const [tags, setTags] = useState(defaultTags);

  useEffect(() => {
    if (open) {
      setStrategy(defaultStrategy);
      setPrune(defaultPrune);
      setTags(defaultTags);
    }
  }, [open, defaultStrategy, defaultPrune, defaultTags]);

  if (!open) {
    return null;
  }

  const submit = () => onConfirm({ strategy, prune, tags });

  return (
    <Dialog onClose={onCancel} title="Pull" titleId={titleId}>
      <DialogBody className={styles.body}>
        <span className={styles.fieldLabel}>Strategy</span>
        <div className={styles.radioGroup}>
          {STRATEGIES.map((s) => (
            <label key={s.id} className={styles.radioRow}>
              <input
                type="radio"
                className={styles.radio}
                name="pull-strategy"
                value={s.id}
                checked={strategy === s.id}
                onChange={() => setStrategy(s.id)}
              />
              <span>
                <strong>{s.label}</strong> — {s.description}
              </span>
            </label>
          ))}
        </div>

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={prune}
            onChange={(e) => setPrune(e.target.checked)}
          />
          <span>Prune deleted remote-tracking branches</span>
        </label>

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={tags}
            onChange={(e) => setTags(e.target.checked)}
          />
          <span>Include tags</span>
        </label>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          Pull
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
