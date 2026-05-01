import { useEffect, useId, useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  WarningIcon,
} from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { Input } from "../Input/Input";
import styles from "./RebaseEditor.module.css";

export type RebaseAction =
  | "drop"
  | "edit"
  | "fixup"
  | "pick"
  | "reword"
  | "squash";

export interface RebaseEditorCommit {
  author: string;
  hash: string;
  subject: string;
}

export interface RebasePlanEntry {
  action: RebaseAction;
  hash: string;
  newSubject?: string;
}

export interface RebaseEditorProps {
  baseRef: string;
  commits: RebaseEditorCommit[];
  onCancel: () => void;
  onConfirm: (plan: RebasePlanEntry[]) => void;
  open: boolean;
  /** Hash of the commit a paused rebase stopped at (highlighted). */
  pausedAt?: string | null;
  onAbort?: () => void;
  onContinue?: () => void;
}

interface PlanRow {
  action: RebaseAction;
  hash: string;
  author: string;
  subject: string;
  newSubject: string;
}

const ACTION_ORDER: RebaseAction[] = [
  "pick",
  "reword",
  "edit",
  "squash",
  "fixup",
  "drop",
];

const ACTION_LABEL: Record<RebaseAction, string> = {
  pick: "pick",
  reword: "reword",
  edit: "edit",
  squash: "squash",
  fixup: "fixup",
  drop: "drop",
};

const ACTION_DESCRIPTION: Record<RebaseAction, string> = {
  pick: "Use the commit as is",
  reword: "Use the commit, but edit the subject",
  edit: "Pause for amend after applying",
  squash: "Combine into the previous commit (keep both messages)",
  fixup: "Combine into the previous commit (drop this message)",
  drop: "Remove the commit entirely",
};

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

export function RebaseEditor({
  baseRef,
  commits,
  onCancel,
  onConfirm,
  open,
  pausedAt,
  onAbort,
  onContinue,
}: RebaseEditorProps) {
  const titleId = useId();
  const [rows, setRows] = useState<PlanRow[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setRows(
      commits.map((c) => ({
        action: "pick",
        hash: c.hash,
        author: c.author,
        subject: c.subject,
        newSubject: c.subject,
      })),
    );
  }, [open, commits]);

  const validation = useMemo(() => validatePlan(rows), [rows]);

  if (!open) {
    return null;
  }

  const setAction = (idx: number, action: RebaseAction) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, action } : r)));
  };

  const setSubject = (idx: number, value: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, newSubject: value } : r)),
    );
  };

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= rows.length) {
      return;
    }
    setRows((prev) => {
      const next = [...prev];
      const a = next[idx]!;
      const b = next[target]!;
      next[idx] = b;
      next[target] = a;

      return next;
    });
  };

  const submit = () => {
    if (!validation.ok) {
      return;
    }
    const plan: RebasePlanEntry[] = rows.map((r) => {
      const entry: RebasePlanEntry = { hash: r.hash, action: r.action };
      if (r.action === "reword" && r.newSubject !== r.subject) {
        entry.newSubject = r.newSubject;
      }

      return entry;
    });
    onConfirm(plan);
  };

  const isPaused = Boolean(pausedAt);

  return (
    <Dialog
      onClose={onCancel}
      size="medium"
      title={isPaused ? "Rebase paused" : "Interactive rebase"}
      titleId={titleId}
    >
      <div className={styles.body}>
        <div className={styles.metaRow}>
          <span className={styles.fieldLabel}>Base</span>
          <code className={styles.baseRef}>{baseRef}</code>
        </div>

        {isPaused && (
          <div className={styles.pausedBanner}>
            <WarningIcon size={14} />
            <span>
              Rebase paused at <code>{shortHash(pausedAt ?? "")}</code>. Resolve
              conflicts in the working copy, then Continue or Abort.
            </span>
          </div>
        )}

        {rows.length === 0 ? (
          <div className={styles.empty}>No commits in range.</div>
        ) : (
          <ol className={styles.list}>
            {rows.map((row, i) => {
              const paused = pausedAt === row.hash;

              return (
                <li
                  key={row.hash}
                  className={[
                    styles.row,
                    row.action === "drop" ? styles.rowDrop : "",
                    paused ? styles.rowPaused : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className={styles.reorder}>
                    <button
                      aria-label="Move up"
                      className={styles.reorderBtn}
                      disabled={i === 0 || isPaused}
                      type="button"
                      onClick={() => move(i, -1)}
                    >
                      <ChevronDownIcon size={9} className={styles.flipUp} />
                    </button>
                    <button
                      aria-label="Move down"
                      className={styles.reorderBtn}
                      disabled={i === rows.length - 1 || isPaused}
                      type="button"
                      onClick={() => move(i, 1)}
                    >
                      <ChevronRightIcon size={9} className={styles.flipDown} />
                    </button>
                  </div>

                  <select
                    aria-label={`Action for ${shortHash(row.hash)}`}
                    className={styles.actionPicker}
                    disabled={isPaused}
                    value={row.action}
                    onChange={(e) =>
                      setAction(i, e.target.value as RebaseAction)
                    }
                    title={ACTION_DESCRIPTION[row.action]}
                  >
                    {ACTION_ORDER.map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABEL[a]}
                      </option>
                    ))}
                  </select>

                  <code className={styles.hash}>{shortHash(row.hash)}</code>

                  <div className={styles.subjectArea}>
                    <span className={styles.subject}>{row.subject}</span>
                    <span className={styles.author}>{row.author}</span>
                    {row.action === "reword" && (
                      <Input
                        autoFocus
                        className={styles.rewordInput}
                        placeholder="New subject"
                        value={row.newSubject}
                        onChange={(e) => setSubject(i, e.target.value)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {!validation.ok && (
          <div className={styles.errorMsg}>{validation.message}</div>
        )}
      </div>

      <div className={styles.footer}>
        {isPaused && onAbort && (
          <Button variant="danger" onClick={onAbort}>
            Abort rebase
          </Button>
        )}
        {isPaused && onContinue && (
          <Button variant="primary" onClick={onContinue}>
            Continue
          </Button>
        )}
        {!isPaused && (
          <>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              disabled={!validation.ok}
              variant="primary"
              onClick={submit}
            >
              Start rebase
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

interface ValidationResult {
  message?: string;
  ok: boolean;
}

function validatePlan(rows: PlanRow[]): ValidationResult {
  if (rows.length === 0) {
    return { ok: false, message: "Plan is empty." };
  }
  // Need at least one pick; the first non-drop entry must be pick (squash and
  // fixup require a previous commit to fold into).
  let firstNonDrop: PlanRow | null = null;
  for (const r of rows) {
    if (r.action === "drop") {
      continue;
    }
    firstNonDrop = r;
    break;
  }
  if (!firstNonDrop) {
    return {
      ok: false,
      message: "All commits are dropped — at least one pick is required.",
    };
  }
  if (firstNonDrop.action === "squash" || firstNonDrop.action === "fixup") {
    return {
      ok: false,
      message: `Cannot ${firstNonDrop.action} the first surviving commit.`,
    };
  }

  return { ok: true };
}
