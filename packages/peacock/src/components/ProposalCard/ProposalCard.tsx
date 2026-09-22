import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowUpRightIcon, PlayIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { ConfidenceMeter } from "../ConfidenceMeter/ConfidenceMeter";
import { Input } from "../Input/Input";
import styles from "./ProposalCard.module.css";

export interface ProposalCardAction {
  /** `start` spins up work; `open` sends the user somewhere. */
  kind: "open" | "start";
  label: string;
  onClick: () => void;
}

export interface ProposalCardProps {
  /** Disables every action while one is in flight. */
  busy?: boolean;
  /** 0..1, self-reported by the run that emitted the proposal. */
  confidence: number;
  /**
   * What already happened to it — started, dismissed, cleared by a later run.
   * Set it and the card reads rather than acts: there is nothing left to press.
   */
  decided?: ReactNode;
  /** Optional trailing chips — project, recommended action, automation. */
  meta?: ReactNode;
  onDismiss: (reason: string) => void;
  /** Absent when the proposal came from no external work item. */
  onOpenSource?: () => void;
  /**
   * The one action the proposal is asking for. Omit it when there is nothing
   * to do but dismiss — an offer to start work that does not exist is worse
   * than no button.
   */
  primary?: ProposalCardAction;
  /** Why the run ranked it where it did. Shown under the summary. */
  rationale?: string;
  /** External work item this came from, e.g. `plexinc/app#412`. */
  sourceLabel?: string;
  summary: string;
  title: string;
}

/**
 * One thing an automation wants you to decide on. At most three actions: the
 * one the proposal asks for, dismiss it (with an optional reason), or open the
 * issue it came from. The dismiss reason is a one-line inline field, never a
 * dialog — it is the signal that teaches the automation, so asking for it must
 * cost nothing.
 */
export function ProposalCard({
  busy,
  confidence,
  decided,
  meta,
  onDismiss,
  onOpenSource,
  primary,
  rationale,
  sourceLabel,
  summary,
  title,
}: ProposalCardProps) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");

  const confirmDismiss = () => {
    setDismissing(false);
    onDismiss(reason.trim());
    setReason("");
  };

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <ConfidenceMeter value={confidence} />
      </header>

      <p className={styles.summary}>{summary}</p>
      {rationale && <p className={styles.rationale}>{rationale}</p>}

      {meta != null && <div className={styles.meta}>{meta}</div>}

      {decided != null && <p className={styles.decided}>{decided}</p>}

      {decided == null && dismissing && (
        <div className={styles.dismissRow}>
          <Input
            aria-label="Why are you dismissing this?"
            autoFocus
            className={styles.reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmDismiss();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissing(false);
              }
            }}
            placeholder="Why not? (optional)"
            value={reason}
          />
          <Button
            disabled={busy}
            onClick={confirmDismiss}
            size="sm"
            variant="secondary"
          >
            Dismiss
          </Button>
          <Button
            disabled={busy}
            onClick={() => setDismissing(false)}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </div>
      )}

      {decided == null && !dismissing && (
        <div className={styles.actions}>
          {primary && (
            <Button
              disabled={busy}
              leading={
                primary.kind === "start" ? (
                  <PlayIcon size={11} />
                ) : (
                  <ArrowUpRightIcon size={11} />
                )
              }
              onClick={primary.onClick}
              size="sm"
            >
              {primary.label}
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => setDismissing(true)}
            size="sm"
            variant="ghost"
          >
            Dismiss
          </Button>
          <span className={styles.spacer} />
          {onOpenSource && (
            <Button
              disabled={busy}
              onClick={onOpenSource}
              size="sm"
              trailing={<ArrowUpRightIcon size={11} />}
              variant="ghost"
            >
              {sourceLabel ?? "Open source"}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
