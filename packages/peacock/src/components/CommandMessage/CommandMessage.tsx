import type { MouseEvent, ReactNode } from "react";
import { TerminalIcon } from "../../icons/Icons";
import { Disclosure } from "../Disclosure/Disclosure";
import { Markdown } from "../Markdown/Markdown";
import styles from "./CommandMessage.module.css";

/** Where the command's argument leads: an external URL, or an in-app screen. */
export interface CommandArgumentLink {
  href?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** Opens in a new tab, for a URL outside the app. */
  external?: boolean;
}

export interface CommandMessageProps {
  /** The command without its slash, e.g. `implement-ticket`. */
  name: string;
  /** The main argument, e.g. a ticket. */
  argument?: string;
  argumentLink?: CommandArgumentLink;
  /** What the user wrote after the argument. */
  notes?: string;
  /** The expanded prompt the agent received; adds the playbook disclosure. */
  prompt?: string;
  renderMarkdown?: (text: string) => ReactNode;
  defaultPlaybookOpen?: boolean;
  onPlaybookOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * A slash command in a sent message: the command as a pill with its argument,
 * the user's notes, and the playbook it expanded into a click away.
 */
export function CommandMessage({
  name,
  argument,
  argumentLink,
  notes,
  prompt,
  renderMarkdown,
  defaultPlaybookOpen,
  onPlaybookOpenChange,
  className,
}: CommandMessageProps) {
  const renderMd =
    renderMarkdown ?? ((text: string) => <Markdown text={text} />);

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")}>
      <div className={styles.head}>
        <span className={styles.command}>
          <TerminalIcon size={11} />/{name}
        </span>
        {argument &&
          (argumentLink ? (
            <a
              className={styles.argumentLink}
              href={argumentLink.href ?? "#"}
              rel={argumentLink.external ? "noopener noreferrer" : undefined}
              target={argumentLink.external ? "_blank" : undefined}
              onClick={(e) => {
                if (argumentLink.onClick) {
                  e.preventDefault();
                  argumentLink.onClick(e);
                }
              }}
            >
              {argument}
            </a>
          ) : (
            <span className={styles.argument}>{argument}</span>
          ))}
      </div>
      {notes && <p className={styles.notes}>{notes}</p>}
      {prompt && (
        <Disclosure
          bodyClassName={styles.playbook}
          defaultOpen={defaultPlaybookOpen}
          openToggleLabel="Hide playbook"
          toggleLabel="Show playbook"
          onOpenChange={onPlaybookOpenChange}
        >
          {renderMd(prompt)}
        </Disclosure>
      )}
    </div>
  );
}
