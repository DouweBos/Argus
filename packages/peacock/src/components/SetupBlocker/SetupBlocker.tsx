import type { ReactNode } from "react";
import { TerminalIcon, WarningIcon } from "../../icons/Icons";
import { CopyField } from "../CopyField/CopyField";
import { Disclosure } from "../Disclosure/Disclosure";
import styles from "./SetupBlocker.module.css";

export type SetupBlockerTone = "error" | "info" | "warning";

export interface SetupBlockerProps {
  tone?: SetupBlockerTone;
  /** What didn't happen, in one line. */
  title: string;
  /** Why, in plain language. */
  explanation: string;
  /** What to do about it, in order. */
  steps?: string[];
  /** A shell command that fixes it, offered ready to copy. */
  command?: string;
  /** The other way out, when there is one. */
  alternative?: ReactNode;
  /** Raw failure text, kept behind a toggle. */
  detail?: string;
  /** Buttons — retry, open settings, and so on. */
  actions?: ReactNode;
  className?: string;
}

/**
 * A blocked action explained rather than reported: what went wrong, why it
 * went wrong, and the steps out of it.
 *
 * For the failures that have a known cause and a known fix — a missing CLI, a
 * daemon that isn't signed in. A raw error string leaves the user guessing at
 * all three.
 */
export function SetupBlocker({
  tone = "error",
  title,
  explanation,
  steps,
  command,
  alternative,
  detail,
  actions,
  className,
}: SetupBlockerProps) {
  return (
    <div
      className={[styles.blocker, styles[tone], className]
        .filter(Boolean)
        .join(" ")}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className={styles.head}>
        <span className={styles.icon}>
          <WarningIcon size={14} />
        </span>
        <p className={styles.title}>{title}</p>
      </div>
      <p className={styles.explanation}>{explanation}</p>
      {steps && steps.length > 0 && (
        <ol className={styles.steps}>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {command && (
        <div className={styles.command}>
          <span className={styles.commandIcon}>
            <TerminalIcon size={12} />
          </span>
          <CopyField
            className={styles.commandField}
            copyLabel={`Copy ${command}`}
            value={command}
          />
        </div>
      )}
      {alternative && <p className={styles.alternative}>{alternative}</p>}
      {detail && (
        <Disclosure toggleLabel="What Argus saw">
          <pre className={styles.detail}>{detail}</pre>
        </Disclosure>
      )}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
