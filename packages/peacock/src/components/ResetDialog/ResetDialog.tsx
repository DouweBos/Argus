import { useEffect, useId, useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import styles from "./ResetDialog.module.css";

export type ResetMode = "hard" | "mixed" | "soft";

export interface ResetDialogResult {
  mode: ResetMode;
}

export interface ResetDialogProps {
  open: boolean;
  /** The ref the user is resetting HEAD to (display-only — passed back as-is). */
  targetRef: string;
  /** Optional commit subject shown beneath the ref for orientation. */
  targetSubject?: string;
  defaultMode?: ResetMode;
  onConfirm: (result: ResetDialogResult) => void;
  onCancel: () => void;
}

const MODES: { id: ResetMode; label: string; description: string }[] = [
  {
    id: "soft",
    label: "Soft",
    description:
      "Move HEAD only. Keep working copy and index — your changes become staged.",
  },
  {
    id: "mixed",
    label: "Mixed (default)",
    description:
      "Move HEAD and reset index. Keep working copy — your changes become unstaged.",
  },
  {
    id: "hard",
    label: "Hard",
    description:
      "Move HEAD, reset index, and discard working-copy changes. This deletes uncommitted work.",
  },
];

export function ResetDialog({
  open,
  targetRef,
  targetSubject,
  defaultMode = "mixed",
  onConfirm,
  onCancel,
}: ResetDialogProps) {
  const titleId = useId();
  const [mode, setMode] = useState<ResetMode>(defaultMode);

  useEffect(() => {
    if (open) {
      setMode(defaultMode);
    }
  }, [open, defaultMode]);

  if (!open) {
    return null;
  }

  const submit = () => onConfirm({ mode });

  return (
    <Dialog onClose={onCancel} title="Reset HEAD" titleId={titleId}>
      <div className={styles.body}>
        <span className={styles.fieldLabel}>Target</span>
        <div className={styles.target}>
          {targetRef}
          {targetSubject ? ` — ${targetSubject}` : ""}
        </div>

        <span className={styles.fieldLabel}>Mode</span>
        <div className={styles.radioGroup}>
          {MODES.map((m) => (
            <label key={m.id} className={styles.radioRow}>
              <input
                type="radio"
                className={styles.radio}
                name="reset-mode"
                value={m.id}
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
              />
              <span>
                <strong>{m.label}</strong> — {m.description}
              </span>
            </label>
          ))}
        </div>

        {mode === "hard" && (
          <div className={styles.warning}>
            Hard reset deletes uncommitted changes. This cannot be undone.
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={mode === "hard" ? "danger" : "primary"}
          onClick={submit}
        >
          Reset {mode}
        </Button>
      </div>
    </Dialog>
  );
}
