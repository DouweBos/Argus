import { useCallback } from "react";
import { renderMarkdown } from "../../../lib/markdown";
import styles from "./PlanApproval.module.css";

interface PlanApprovalProps {
  onApprove: () => void;
  onReject: () => void;
  plan: string;
}

export function PlanApproval({ plan, onApprove, onReject }: PlanApprovalProps) {
  const handleApprove = useCallback(() => onApprove(), [onApprove]);
  const handleReject = useCallback(() => onReject(), [onReject]);

  return (
    <div className={styles.wrap}>
      <div className={styles.label}>Proposed plan</div>
      <div
        className={styles.plan}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(plan) }}
      />
      <div className={styles.actions}>
        <button className={styles.approveBtn} onClick={handleApprove}>
          Approve &amp; exit plan mode
        </button>
        <button className={styles.rejectBtn} onClick={handleReject}>
          Keep planning
        </button>
      </div>
    </div>
  );
}
