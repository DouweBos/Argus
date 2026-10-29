import type { LinearHistoryEvent, LinearIssueDetail } from "../../../lib/types";
import type { ReactNode } from "react";
import {
  type ActivityItem,
  Avatar,
  Icons,
  IssueActivity,
  IssueStatusIcon,
  Markdown,
  PriorityIcon,
} from "@argus/peacock";
import { figmaLinkHandler } from "../../../lib/designViewer";
import { ago, issueTimeline } from "../../../lib/issueActivity";
import { CommentComposer } from "./CommentComposer";
import styles from "./IssueDetail.module.css";
import { renderLinearEmbed } from "./linearEmbed";

const openFigmaLink = figmaLinkHandler("issue");

function eventIcon(
  event: LinearHistoryEvent,
  issue: LinearIssueDetail,
): ReactNode {
  switch (event.kind) {
    case "status":
      return <IssueStatusIcon size={12} type={issue.state.type} />;
    case "priority":
      return <PriorityIcon size={12} priority={issue.priority} />;
    case "attachment":
      return <Icons.LinkIcon size={11} />;
    case "cycle":
      return <Icons.RefreshIcon size={11} />;
    case "assignee":
    case "created":
      return event.actor ? (
        <Avatar name={event.actor} size={14} src={event.actorAvatarUrl} />
      ) : null;
    case "labels":
      return <Icons.TagIcon size={11} />;
    case "title":
    case "description":
      return <Icons.PencilIcon size={11} />;
    default:
      return <Icons.HistoryIcon size={11} />;
  }
}

/** History and discussion in one timeline, with a reply box per thread. */
export function IssueActivitySection({ issue }: { issue: LinearIssueDetail }) {
  const items: ActivityItem[] = issueTimeline(issue).map((entry) =>
    entry.kind === "event"
      ? {
          kind: "event",
          id: entry.event.id,
          icon: eventIcon(entry.event, issue),
          actor: entry.event.actor ?? "Linear",
          text: entry.event.text,
          time: ago(entry.event.createdAt),
        }
      : {
          kind: "thread",
          id: entry.thread.root.id ?? String(entry.at),
          comments: [entry.thread.root, ...entry.thread.replies].map(
            (c, i) => ({
              id: c.id ?? `${entry.at}-${i}`,
              author: c.author ?? "Someone",
              avatarUrl: c.authorAvatarUrl,
              time: ago(c.createdAt),
              body: (
                <Markdown
                  renderEmbed={renderLinearEmbed}
                  text={c.body}
                  onLinkClick={openFigmaLink}
                />
              ),
              reactions: c.reactions ?? undefined,
            }),
          ),
          footer: entry.thread.root.id ? (
            <CommentComposer
              issue={issue}
              parentId={entry.thread.root.id}
              placeholder="Leave a reply…"
            />
          ) : undefined,
        },
  );
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
      footer={<CommentComposer issue={issue} placeholder="Leave a comment…" />}
    />
  );
}
