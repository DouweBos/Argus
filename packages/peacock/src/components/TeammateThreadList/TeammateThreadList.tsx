import { ChatIcon, ComposeIcon, WarningIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import styles from "./TeammateThreadList.module.css";

export interface TeammateThreadListItem {
  id: string;
  /** Empty until something is said in it. */
  title: string;
  /** "2h ago". */
  lastOpenedLabel: string;
  /** Where it started when not here: "Slack", "Linear", "Handoff". */
  surfaceLabel?: string;
  /** Its last turn stopped short. */
  failed?: boolean;
}

export interface TeammateThreadListProps {
  threads: TeammateThreadListItem[];
  selectedId?: string | null;
  onOpen: (threadId: string) => void;
  /** Omit both where this client may not start or archive one. */
  onNew?: () => void;
  onArchive?: (threadId: string) => void;
  /** A new one is being opened. */
  creating?: boolean;
}

/** A teammate's conversations, newest first, with New conversation and Archive. */
export function TeammateThreadList({
  creating,
  onArchive,
  onNew,
  onOpen,
  selectedId,
  threads,
}: TeammateThreadListProps) {
  return (
    <nav aria-label="Conversations" className={styles.list}>
      <div className={styles.head}>
        <span className={styles.title}>Conversations</span>
        {onNew && (
          <FlatIconButton
            disabled={creating}
            icon={<ComposeIcon size={14} />}
            label="New conversation"
            size="sm"
            onClick={onNew}
          />
        )}
      </div>
      {threads.length === 0 && (
        <p className={styles.empty}>No conversations yet.</p>
      )}
      {threads.map((thread) => (
        <div
          className={[
            styles.item,
            thread.id === selectedId ? styles.selected : "",
          ].join(" ")}
          key={thread.id}
        >
          <button
            aria-current={thread.id === selectedId ? "page" : undefined}
            className={styles.open}
            type="button"
            onClick={() => onOpen(thread.id)}
          >
            {thread.failed ? (
              <WarningIcon
                aria-label="Stopped"
                className={styles.failedIcon}
                size={12}
              />
            ) : (
              <ChatIcon className={styles.icon} size={12} />
            )}
            <span className={styles.text}>
              <span className={styles.threadTitle}>
                {thread.title || "New conversation"}
              </span>
              <span className={styles.when}>
                {thread.surfaceLabel && (
                  <Badge size="tag" tone="neutral">
                    {thread.surfaceLabel}
                  </Badge>
                )}
                {thread.lastOpenedLabel}
              </span>
            </span>
          </button>
          {onArchive && (
            <Button
              className={styles.archive}
              size="sm"
              variant="ghost"
              onClick={() => onArchive(thread.id)}
            >
              Archive
            </Button>
          )}
        </div>
      ))}
    </nav>
  );
}
