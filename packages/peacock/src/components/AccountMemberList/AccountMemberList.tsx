import type { ReactNode } from "react";
import { ChevronRightIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { StatusBulb, type StatusBulbTone } from "../StatusBulb/StatusBulb";
import styles from "./AccountMemberList.module.css";

export interface AccountMemberEntry {
  id: string;
  label: string;
  /** Secondary line: kind, presence, or why it can't be opened. */
  detail?: string;
  /** Presence dot; omit for members that have none (devices). */
  tone?: StatusBulbTone;
  /** Short tag after the name, e.g. "This browser". */
  tag?: string;
  /** Not openable right now (offline, no route); shown dimmed. */
  disabled?: boolean;
  /** Trailing controls (e.g. `AccountMemberActions`); only on rows without `onSelect`. */
  actions?: ReactNode;
}

export interface AccountMemberListProps {
  members: AccountMemberEntry[];
  /** Shown when there are no members. */
  emptyText?: string;
  /** Makes rows open something (a computer); omit for a read-only list. */
  onSelect?: (id: string) => void;
}

/**
 * Computers or devices on an Argus account. Rows open when `onSelect` is
 * given — a computer to connect to — and are a plain list otherwise, with
 * optional trailing actions per row.
 */
export function AccountMemberList({
  members,
  emptyText,
  onSelect,
}: AccountMemberListProps) {
  if (members.length === 0) {
    return emptyText ? <p className={styles.empty}>{emptyText}</p> : null;
  }

  return (
    <ul className={styles.list}>
      {members.map((m) => {
        const body = (
          <>
            {m.tone && <StatusBulb tone={m.tone} size="sm" />}
            <span className={styles.body}>
              <span className={styles.name}>
                <span className={styles.label}>{m.label}</span>
                {m.tag && <Badge tone="neutral">{m.tag}</Badge>}
              </span>
              {m.detail && <span className={styles.detail}>{m.detail}</span>}
            </span>
          </>
        );

        return (
          <li key={m.id}>
            {onSelect ? (
              <button
                type="button"
                className={`${styles.row} ${styles.pick}`}
                disabled={m.disabled}
                onClick={() => onSelect(m.id)}
              >
                {body}
                <ChevronRightIcon size={14} className={styles.chevron} />
              </button>
            ) : (
              <div className={styles.row}>
                {body}
                {m.actions && <div className={styles.actions}>{m.actions}</div>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
