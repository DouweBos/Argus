import { TerminalIcon } from "../../icons/Icons";
import styles from "./CommandMessage.module.css";

export interface CommandMessageProps {
  /** The runner's command without its slash, e.g. `compact`. */
  name: string;
  /** Whatever followed the command's name. */
  args?: string;
  className?: string;
}

/** A runner slash command in a sent message: the command as a chip, its args as text. */
export function CommandMessage({ name, args, className }: CommandMessageProps) {
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")}>
      <span className={styles.command}>
        <TerminalIcon size={11} />/{name}
      </span>
      {args && <p className={styles.args}>{args}</p>}
    </div>
  );
}
