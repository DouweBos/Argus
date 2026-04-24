import { type KeyboardEvent, useCallback, useState } from "react";
import { Dialog, Icons } from "@argus/peacock";
import { Markdown } from "../../shared/Markdown";
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
  const [expanded, setExpanded] = useState(false);

  const handleApprove = useCallback(() => onApprove(), [onApprove]);
  const handleReject = useCallback(() => onReject(), [onReject]);

  const handleSend = useCallback(() => {
    const trimmed = feedback.trim();
    if (!trimmed) {
      return;
    }
    onSubmitFeedback(trimmed);
    setFeedback("");
    setExpanded(false);
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

  const feedbackBlock = (
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
  );

  const actionsBlock = (
    <div className={styles.actions}>
      <button className={styles.approveBtn} onClick={handleApprove}>
        Approve &amp; exit plan mode
      </button>
      <button className={styles.rejectBtn} onClick={handleReject}>
        Keep planning
      </button>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.label}>Proposed plan</div>
        <button
          aria-label="Open plan in dialog"
          className={styles.expandBtn}
          onClick={() => setExpanded(true)}
          title="Open plan in dialog"
          type="button"
        >
          <Icons.EnlargeIcon size={12} />
        </button>
      </div>
      <Markdown className={styles.plan} text={plan} />
      {feedbackBlock}
      {actionsBlock}
      {expanded && (
        <Dialog
          onClose={() => setExpanded(false)}
          size="full"
          title="Proposed plan"
          titleId="plan-approval-dialog"
        >
          <div className={styles.dialogBody}>
            <Markdown className={styles.dialogPlan} text={plan} />
            {feedbackBlock}
            {actionsBlock}
          </div>
        </Dialog>
      )}
    </div>
  );
}
