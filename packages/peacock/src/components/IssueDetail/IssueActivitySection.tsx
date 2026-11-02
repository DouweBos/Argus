import type { IssueTextProps } from "./IssueBody";
import type {
  LinearComment,
  LinearHistoryEvent,
  LinearIssueDetail,
} from "@argus/remote-protocol";
import type { ReactNode } from "react";
import {
  HistoryIcon,
  LinkIcon,
  PencilIcon,
  RefreshIcon,
  TagIcon,
} from "../../icons/Icons";
import { Avatar } from "../Avatar/Avatar";
import {
  type ActivityItem,
  IssueActivity,
} from "../IssueActivity/IssueActivity";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { Markdown } from "../Markdown/Markdown";
import { PriorityIcon } from "../PriorityIcon/PriorityIcon";
import { CommentComposer } from "./CommentComposer";
import styles from "./IssueDetail.module.css";

/** History lines and comment threads in one timeline, oldest first. */
export type IssueTimelineItem =
  | {
      at: number;
      kind: "thread";
      thread: { replies: LinearComment[]; root: LinearComment };
    }
  | { at: number; event: LinearHistoryEvent; kind: "event" };

export interface IssueActivitySectionProps extends IssueTextProps {
  ago: (epochMs: number) => string;
  issue: LinearIssueDetail;
  /** Null hides the comment and reply boxes. */
  onComment: ((body: string, parentId: string | null) => Promise<void>) | null;
  timeline: IssueTimelineItem[];
}

function eventIcon(
  event: LinearHistoryEvent,
  issue: LinearIssueDetail,
): ReactNode {
  switch (event.kind) {
    case "status":
      return (
        <IssueStatusIcon
          color={issue.state.color}
          size={12}
          type={issue.state.type}
        />
      );
    case "priority":
      return <PriorityIcon size={12} priority={issue.priority} />;
    case "attachment":
      return <LinkIcon size={11} />;
    case "cycle":
      return <RefreshIcon size={11} />;
    case "assignee":
    case "created":
      return event.actor ? (
        <Avatar name={event.actor} size={14} src={event.actorAvatarUrl} />
      ) : null;
    case "labels":
      return <TagIcon size={11} />;
    case "title":
    case "description":
      return <PencilIcon size={11} />;
    default:
      return <HistoryIcon size={11} />;
  }
}

/** History and discussion in one timeline, with a reply box per thread. */
export function IssueActivitySection({
  ago,
  issue,
  onComment,
  onLinkClick,
  renderEmbed,
  timeline,
}: IssueActivitySectionProps) {
  const items: ActivityItem[] = timeline.map((entry) => {
    if (entry.kind === "event") {
      return {
        kind: "event",
        id: entry.event.id,
        icon: eventIcon(entry.event, issue),
        actor: entry.event.actor ?? "Linear",
        text: entry.event.text,
        time: ago(entry.event.createdAt),
      };
    }
    const { root, replies } = entry.thread;
    const rootId = root.id;

    return {
      kind: "thread",
      id: rootId ?? String(entry.at),
      comments: [root, ...replies].map((c, i) => ({
        id: c.id ?? `${entry.at}-${i}`,
        author: c.author ?? "Someone",
        avatarUrl: c.authorAvatarUrl,
        time: ago(c.createdAt),
        body: (
          <Markdown
            renderEmbed={renderEmbed}
            text={c.body}
            onLinkClick={onLinkClick}
          />
        ),
        reactions: c.reactions ?? undefined,
      })),
      footer:
        rootId && onComment ? (
          <CommentComposer
            placeholder="Leave a reply…"
            sendLabel="Reply"
            onPost={(body) => onComment(body, rootId)}
          />
        ) : undefined,
    };
  });
  const subscribers = issue.subscribers ?? [];

  return (
    <IssueActivity
      items={items}
      headerAside={
        subscribers.length > 0 && (
          <span
            className={styles.subscribers}
            title={`Subscribed: ${subscribers.map((s) => s.name).join(", ")}`}
          >
            {subscribers.slice(0, 5).map((s) => (
              <Avatar key={s.name} name={s.name} size={20} src={s.avatarUrl} />
            ))}
          </span>
        )
      }
      footer={
        onComment && (
          <CommentComposer
            placeholder="Leave a comment…"
            onPost={(body) => onComment(body, null)}
          />
        )
      }
    />
  );
}
