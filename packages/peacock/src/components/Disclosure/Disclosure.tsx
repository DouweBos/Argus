import type { ReactNode } from "react";
import { useId, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "../../icons/Icons";
import styles from "./Disclosure.module.css";

export interface DisclosureProps {
  /** The one line that is always visible; omit for a bare toggle. */
  summary?: ReactNode;
  /** The label on the toggle, e.g. "What they can do". */
  toggleLabel?: string;
  /** The toggle's label while open, e.g. "Hide playbook"; defaults to `toggleLabel`. */
  openToggleLabel?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  bodyClassName?: string;
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
  openToggleLabel,
  children,
  defaultOpen = false,
  onOpenChange,
  className,
  bodyClassName,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")}>
      {summary && <p className={styles.summary}>{summary}</p>}
      <button
        type="button"
        aria-controls={bodyId}
        aria-expanded={open}
        className={styles.toggle}
        onClick={() => {
          setOpen(!open);
          onOpenChange?.(!open);
        }}
      >
        {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        {open ? (openToggleLabel ?? toggleLabel) : toggleLabel}
      </button>
      {open && (
        <div
          className={[styles.body, bodyClassName].filter(Boolean).join(" ")}
          id={bodyId}
        >
          {children}
        </div>
      )}
    </div>
  );
}
