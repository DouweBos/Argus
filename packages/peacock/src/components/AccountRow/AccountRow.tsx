import { useEffect, useRef, useState } from "react";
import { CheckIcon, PencilIcon, TrashIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import styles from "./AccountRow.module.css";

export interface AccountRowProps {
  /** Marks the row as the one in use; suppresses the "Use" affordance. */
  active?: boolean;
  /** Disables every action while a mutation is in flight. */
  busy?: boolean;
  /** Secondary line, e.g. the organization name. */
  detail?: string;
  /** Primary line — display name, falling back to the email. */
  label: string;
  onRemove?: () => void;
  /** Omit to make the row non-renamable. */
  onRename?: (label: string) => void;
  onSelect?: () => void;
  /** Short trailing tag, e.g. the subscription plan. */
  plan?: string;
}

/**
 * One signed-in account in a switcher list. Clicking the row makes it active;
 * rename edits in place so the list doesn't need a dialog.
 */
export function AccountRow({
  label,
  detail,
  plan,
  active = false,
  busy = false,
  onSelect,
  onRename,
  onRemove,
}: AccountRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== label) {
      onRename?.(draft.trim());
    }
  };

  const startEditing = () => {
    setDraft(label);
    setEditing(true);
  };

  return (
    <div
      className={styles.row}
      data-active={active || undefined}
      data-selectable={onSelect && !active ? true : undefined}
      onClick={active || busy || editing ? undefined : onSelect}
    >
      <span className={styles.mark} aria-hidden={!active}>
        {active ? <CheckIcon className={styles.markIcon} /> : null}
      </span>

      <div className={styles.text}>
        {editing ? (
          <input
            ref={inputRef}
            className={styles.editor}
            value={draft}
            aria-label="Account name"
            onBlur={commit}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit();
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className={styles.label}>{label}</span>
        )}
        {detail ? <span className={styles.detail}>{detail}</span> : null}
      </div>

      {plan ? <Badge tone="neutral">{plan}</Badge> : null}

      <div className={styles.actions}>
        {onRename && !editing ? (
          <button
            type="button"
            className={styles.action}
            aria-label={`Rename ${label}`}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
          >
            <PencilIcon className={styles.actionIcon} />
          </button>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            className={styles.action}
            aria-label={`Remove ${label}`}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <TrashIcon className={styles.actionIcon} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
