import { useState } from "react";
import type { ReactNode } from "react";
import { StatusPill, type StatusPillTone } from "../StatusPill/StatusPill";
import styles from "./ChecklistRow.module.css";

export interface ChecklistRowProps {
  title: string;
  message?: string;
  tone: StatusPillTone;
  detail?: string;
  action?: ReactNode;
  children?: ReactNode;
}

export function ChecklistRow({
  title,
  message,
  tone,
  detail,
  action,
  children,
}: ChecklistRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.row}>
      <div className={styles.header}>
        <div className={styles.textWrap}>
          <div className={styles.titleLine}>
            <span className={styles.title}>{title}</span>
            <StatusPill tone={tone} />
          </div>
          {message ? <div className={styles.message}>{message}</div> : null}
        </div>
        <div className={styles.actions}>
          {detail ? (
            <button
              type="button"
              className={styles.whyButton}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Hide" : "Why"}
            </button>
          ) : null}
          {action}
        </div>
      </div>
      {open && detail ? <div className={styles.detail}>{detail}</div> : null}
      {children}
    </div>
  );
}
