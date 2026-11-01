import type { LoadPhase } from "@argus/client-core";
import type { ReactNode } from "react";
import {
  AgentIcon,
  CheckIcon,
  EnvelopeIcon,
  FileIcon,
  WarningIcon,
} from "../../icons/Icons";
import { Badge, type BadgeTone } from "../Badge/Badge";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { InboxItemRow } from "../InboxItemRow/InboxItemRow";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { Spinner } from "../Spinner/Spinner";
import styles from "./InboxView.module.css";

/** A run in the inbox: an unread report, or a failure. */
export interface InboxRunItem {
  id: string;
  title: string;
  subtitle: string;
  /** "2h ago". */
  when: string;
  onOpen: () => void;
  /** Mark it read; a failure teaches nothing, so dismissing asks for no reason. */
  onDismiss?: () => void;
}

/** Work Argus started off a proposal. */
export interface InboxStartedItem {
  id: string;
  title: string;
  subtitle?: string;
  badge: { label: string; tone: BadgeTone };
  /** "Review" once there are commits to look at, "Open" before. */
  actionLabel?: string;
  onOpen: () => void;
}

/** A proposal a later run took off your hands. */
export interface InboxClearedItem {
  id: string;
  title: string;
  subtitle: string;
  /** "replaced" or "withdrawn". */
  badge: string;
  onOpen: () => void;
}

export interface InboxViewProps {
  phase: LoadPhase;
  /** A refresh that failed behind rows already shown. */
  error?: string | null;
  /** Decision cards, newest first — usually `ProposalCard`s. */
  decide: ReactNode;
  /** How many decisions `decide` holds. */
  pendingCount: number;
  reports: InboxRunItem[];
  started: InboxStartedItem[];
  failed: InboxRunItem[];
  cleared: InboxClearedItem[];
  /** The page title and the count of decisions; omit where the shell titles the screen. */
  header?: boolean;
  emptyBody: string;
  /** Usually the way to the automations. */
  emptyAction?: ReactNode;
  onRetry?: () => void;
}

/** Inbox runs as rows: reports (`neutral`) or failures (`alert`). Home lists failures too. */
export function InboxRunList({
  dismissLabel,
  items,
  tone,
}: {
  dismissLabel: string;
  items: InboxRunItem[];
  tone: "alert" | "neutral";
}) {
  return (
    <div className={styles.rows}>
      {items.map((item) => (
        <InboxItemRow
          actions={
            item.onDismiss && (
              <Button size="sm" variant="ghost" onClick={item.onDismiss}>
                {dismissLabel}
              </Button>
            )
          }
          key={item.id}
          leading={
            tone === "alert" ? (
              <WarningIcon size={12} />
            ) : (
              <FileIcon size={12} />
            )
          }
          meta={
            <Badge tone={tone === "alert" ? "error" : "neutral"}>
              {item.when}
            </Badge>
          }
          subtitle={item.subtitle}
          title={item.title}
          tone={tone}
          onOpen={item.onOpen}
        />
      ))}
    </div>
  );
}

/**
 * What Argus wants from you, grouped by what you would do about it rather
 * than by which automation produced it. Decisions first: a pending proposal
 * outranks a report, which outranks work in flight, which outranks a run that
 * already failed.
 */
export function InboxView({
  cleared,
  decide,
  emptyAction,
  emptyBody,
  error,
  failed,
  header,
  pendingCount,
  onRetry,
  phase,
  reports,
  started,
}: InboxViewProps) {
  const count = pendingCount;
  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <div className={styles.loading}>
        <Spinner />
      </div>
    );
  } else if (phase.kind === "failed") {
    body = (
      <EmptyState
        action={
          onRetry && (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          )
        }
        body={phase.error}
        icon={<EnvelopeIcon size={18} />}
        title="Inbox unavailable"
      />
    );
  } else if (phase.kind === "empty") {
    body = (
      <EmptyState
        action={emptyAction}
        body={emptyBody}
        icon={<EnvelopeIcon size={18} />}
        title="Nothing needs you"
      />
    );
  } else {
    body = (
      <div className={styles.sections}>
        {count > 0 && (
          <SectionPanel plain meta={`${count} waiting`} title="Decide">
            <div className={styles.cards}>{decide}</div>
          </SectionPanel>
        )}
        {reports.length > 0 && (
          <SectionPanel plain meta={`${reports.length}`} title="New reports">
            <InboxRunList
              dismissLabel="Mark read"
              items={reports}
              tone="neutral"
            />
          </SectionPanel>
        )}
        {started.length > 0 && (
          <SectionPanel plain meta={`${started.length}`} title="Argus is on it">
            <div className={styles.rows}>
              {started.map((item) => (
                <InboxItemRow
                  actions={
                    <Button size="sm" variant="secondary" onClick={item.onOpen}>
                      {item.actionLabel ?? "Open"}
                    </Button>
                  }
                  key={item.id}
                  leading={<AgentIcon size={12} />}
                  meta={
                    <Badge tone={item.badge.tone}>{item.badge.label}</Badge>
                  }
                  subtitle={item.subtitle}
                  title={item.title}
                  onOpen={item.onOpen}
                />
              ))}
            </div>
          </SectionPanel>
        )}
        {failed.length > 0 && (
          <SectionPanel plain meta={`${failed.length}`} title="Needs a look">
            <InboxRunList dismissLabel="Dismiss" items={failed} tone="alert" />
          </SectionPanel>
        )}
        {cleared.length > 0 && (
          <SectionPanel
            plain
            meta={`${cleared.length}`}
            title="Argus cleared these"
          >
            <div className={styles.rows}>
              {cleared.map((item) => (
                <InboxItemRow
                  key={item.id}
                  leading={<CheckIcon size={12} />}
                  meta={<Badge tone="neutral">{item.badge}</Badge>}
                  subtitle={item.subtitle}
                  title={item.title}
                  onOpen={item.onOpen}
                />
              ))}
            </div>
          </SectionPanel>
        )}
      </div>
    );
  }

  return (
    <div className={styles.view}>
      {header && (
        <header className={styles.head}>
          <h1 className={styles.title}>Inbox</h1>
          <span className={styles.sub}>
            {count === 0
              ? "No decisions waiting"
              : `${count} decision${count === 1 ? "" : "s"} waiting`}
          </span>
        </header>
      )}
      {error && phase.kind === "content" && (
        <Banner tone="error">{error}</Banner>
      )}
      {body}
    </div>
  );
}
