import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import { Dialog, Icons } from "@argus/peacock";
import {
  clearToolDraft,
  getToolDraft,
  setToolDraft,
} from "../../../stores/conversationStore";
import { Markdown } from "../../shared/Markdown";
import styles from "./PlanApproval.module.css";

interface PlanApprovalProps {
  onApprove: () => void;
  onReject: () => void;
  onSubmitFeedback: (feedback: string) => void;
  plan: string;
  /** Tool-use id used to persist feedback text across view switches. */
  toolUseId?: string;
}

interface PlanApprovalDraft {
  feedback: string;
}

export function PlanApproval({
  plan,
  onApprove,
  onReject,
  onSubmitFeedback,
  toolUseId,
}: PlanApprovalProps) {
  const [feedback, setFeedback] = useState<string>(
    () =>
      (toolUseId ? getToolDraft<PlanApprovalDraft>(toolUseId) : undefined)
        ?.feedback ?? "",
  );
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!toolUseId) {
      return;
    }
    setToolDraft(toolUseId, { feedback } satisfies PlanApprovalDraft);
  }, [toolUseId, feedback]);

  const handleApprove = useCallback(() => {
    if (toolUseId) {
      clearToolDraft(toolUseId);
    }
    onApprove();
  }, [onApprove, toolUseId]);
  const handleReject = useCallback(() => {
    // Keep the feedback draft — "Keep planning" sends them back to refining,
    // and they may want to reuse what they already typed.
    onReject();
  }, [onReject]);

  const handleSend = useCallback(() => {
    const trimmed = feedback.trim();
    if (!trimmed) {
      return;
    }
    onSubmitFeedback(trimmed);
    setFeedback("");
    setExpanded(false);
    if (toolUseId) {
      clearToolDraft(toolUseId);
    }
  }, [feedback, onSubmitFeedback, toolUseId]);

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
