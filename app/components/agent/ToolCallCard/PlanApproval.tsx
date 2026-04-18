import { type KeyboardEvent, useCallback, useState } from "react";
import { renderMarkdown } from "../../../lib/markdown";
import styles from "./PlanApproval.module.css";

interface PlanApprovalProps {
  onApprove: () => void;
  onReject: () => void;
  onSubmitFeedback: (feedback: string) => void;
  plan: string;
}

export function PlanApproval({
  plan,
  onApprove,
  onReject,
  onSubmitFeedback,
}: PlanApprovalProps) {
  const [feedback, setFeedback] = useState("");

  const handleApprove = useCallback(() => onApprove(), [onApprove]);
  const handleReject = useCallback(() => onReject(), [onReject]);

  const handleSend = useCallback(() => {
    const trimmed = feedback.trim();
    if (!trimmed) {
      return;
    }
    onSubmitFeedback(trimmed);
    setFeedback("");
  }, [feedback, onSubmitFeedback]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = feedback.trim().length > 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.label}>Proposed plan</div>
      <div
        className={styles.plan}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(plan) }}
      />
      <div className={styles.feedback}>
        <textarea
          className={styles.feedbackInput}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Refine the plan — type feedback and press ⌘↵"
          rows={2}
          value={feedback}
        />
        <button
          className={styles.sendBtn}
          disabled={!canSend}
          onClick={handleSend}
          type="button"
        >
          Send feedback
        </button>
      </div>
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
