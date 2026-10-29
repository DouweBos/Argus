import { type ReactNode, useState } from "react";
import { ChevronDownIcon } from "../../icons/Icons";
import { Avatar } from "../Avatar/Avatar";
import styles from "./IssueActivity.module.css";

export interface ActivityEvent {
  kind: "event";
  id: string;
  icon: ReactNode;
  actor: string;
  /** "set priority to High". */
  text: string;
  /** "5w ago". */
  time: string;
}

export interface ActivityComment {
  id: string;
  author: string;
  avatarUrl?: string | null;
  time: string;
  body: ReactNode;
  reactions?: { emoji: string; count: number }[];
}

export interface ActivityThread {
  kind: "thread";
  id: string;
  /** The first comment starts the thread; the rest are replies. */
  comments: ActivityComment[];
  /** A reply box, under the thread. */
  footer?: ReactNode;
}

export type ActivityItem = ActivityEvent | ActivityThread;

export interface IssueActivityProps {
  /** After the timeline: the "Leave a comment…" box. */
  footer?: ReactNode;
  /** Beside the title, e.g. subscriber avatars. */
  headerAside?: ReactNode;
  items: ActivityItem[];
  title?: string;
}

/** Runs of this many events or more fold their middle away. */
const FOLD_AT = 4;

type Row =
  | { kind: "fold"; id: string; events: ActivityEvent[] }
  | { kind: "item"; item: ActivityItem };

/** Long runs of events keep their first and last line and fold the rest. */
function fold(items: ActivityItem[]): Row[] {
  const rows: Row[] = [];
  let run: ActivityEvent[] = [];
  const flush = () => {
    if (run.length >= FOLD_AT) {
      rows.push({ kind: "item", item: run[0] });
      rows.push({ kind: "fold", id: run[1].id, events: run.slice(1, -1) });
      rows.push({ kind: "item", item: run[run.length - 1] });
    } else {
      rows.push(...run.map((item) => ({ kind: "item" as const, item })));
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === "event") {
      run.push(item);
    } else {
      flush();
      rows.push({ kind: "item", item });
    }
  }
  flush();

  return rows;
}

function Comment({
  comment,
  reply,
}: {
  comment: ActivityComment;
  reply: boolean;
}) {
  return (
    <div className={reply ? styles.reply : styles.comment}>
      <div className={styles.commentHead}>
        <Avatar name={comment.author} size={18} src={comment.avatarUrl} />
        <span className={styles.author}>{comment.author}</span>
        <span className={styles.muted}>{comment.time}</span>
      </div>
      <div className={styles.body}>{comment.body}</div>
      {comment.reactions && comment.reactions.length > 0 && (
        <div className={styles.reactions}>
          {comment.reactions.map((r) => (
            <span key={r.emoji} className={styles.reaction}>
              {r.emoji} {r.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** An issue's history and discussion in one timeline, like Linear's Activity. */
export function IssueActivity({
  footer,
  headerAside,
  items,
  title = "Activity",
}: IssueActivityProps) {
  const [open, setOpen] = useState<string[]>([]);

  return (
    <section className={styles.root}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {headerAside}
      </div>
      {fold(items).map((row) => {
        if (row.kind === "fold") {
          if (open.includes(row.id)) {
            return row.events.map((event) => (
              <EventLine key={event.id} event={event} />
            ));
          }

          return (
            <button
              key={row.id}
              className={styles.fold}
              type="button"
              onClick={() => setOpen((ids) => [...ids, row.id])}
            >
              <ChevronDownIcon size={10} />
              Show {row.events.length} events
            </button>
          );
        }
        const { item } = row;

        return item.kind === "event" ? (
          <EventLine key={item.id} event={item} />
        ) : (
          <div key={item.id} className={styles.thread}>
            {item.comments.map((comment, i) => (
              <Comment key={comment.id} comment={comment} reply={i > 0} />
            ))}
            {item.footer && (
              <div className={styles.threadFooter}>{item.footer}</div>
            )}
          </div>
        );
      })}
      {footer}
    </section>
  );
}

function EventLine({ event }: { event: ActivityEvent }) {
  return (
    <div className={styles.event}>
      <span className={styles.eventIcon}>{event.icon}</span>
      <span>
        <span className={styles.actor}>{event.actor}</span> {event.text}
        <span className={styles.muted}> · {event.time}</span>
      </span>
    </div>
  );
}
