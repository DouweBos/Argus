import type { ReactNode } from "react";
import { ChevronRightIcon } from "../../icons/Icons";
import { ConfidenceMeter } from "../ConfidenceMeter/ConfidenceMeter";
import styles from "./ProposalSummaryCard.module.css";

export interface ProposalSummaryCardProps {
  /** 0..1, self-reported by the run that emitted the proposal. */
  confidence: number;
  /** Optional trailing chips — project, recommended action, automation. */
  meta?: ReactNode;
  onOpen: () => void;
  /** Clamped to two lines: enough to recognise it, not enough to read it. */
  summary: string;
  title: string;
}

/**
 * A proposal at a glance, for surfaces that are not the inbox. It carries no
 * actions on purpose — deciding happens on the proposal's own page, so a
 * glance never turns into a decision made on a truncated summary.
 */
export function ProposalSummaryCard({
  confidence,
  meta,
  onOpen,
  summary,
  title,
}: ProposalSummaryCardProps) {
  return (
    <button className={styles.card} onClick={onOpen} type="button">
      <span className={styles.head}>
        <span className={styles.title}>{title}</span>
        <ConfidenceMeter value={confidence} />
      </span>
      <span className={styles.summary}>{summary}</span>
      <span className={styles.foot}>
        {meta != null && <span className={styles.meta}>{meta}</span>}
        <span className={styles.open}>
          Open
          <ChevronRightIcon size={11} />
        </span>
      </span>
    </button>
  );
}
