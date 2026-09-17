import type { ReactNode } from "react";
import { useId, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "../../icons/Icons";
import styles from "./Disclosure.module.css";

export interface DisclosureProps {
  /** The one line that is always visible. */
  summary: ReactNode;
  /** The label on the toggle, e.g. "What they can do". */
  toggleLabel?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * One line of copy plus a details toggle.
 *
 * For consequences that are worth stating but not worth stopping for: the
 * summary keeps a repeat action fast, the details carry the part that would
 * surprise someone the first time.
 */
export function Disclosure({
  summary,
  toggleLabel = "Details",
  children,
  defaultOpen = false,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")}>
      <p className={styles.summary}>{summary}</p>
      <button
        type="button"
        aria-controls={bodyId}
        aria-expanded={open}
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        {toggleLabel}
      </button>
      {open && (
        <div className={styles.body} id={bodyId}>
          {children}
        </div>
      )}
    </div>
  );
}
