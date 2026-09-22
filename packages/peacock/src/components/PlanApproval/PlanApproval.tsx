import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import { EnlargeIcon } from "../../icons/Icons";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { Markdown } from "../Markdown/Markdown";
import styles from "./PlanApproval.module.css";

export interface PlanApprovalDraft {
  feedback: string;
}

/** Optional cross-view draft persistence for the feedback text. */
export interface PlanApprovalDrafts {
  clear: () => void;
  get: () => PlanApprovalDraft | undefined;
  set: (draft: PlanApprovalDraft) => void;
}

export interface PlanApprovalProps {
  plan: string;
  onApprove: () => void;
  /** Hand the plan off to a fresh session instead of running it here. Omit to hide. */
  onApproveInNewSession?: () => void;
  onReject: () => void;
  onSubmitFeedback: (feedback: string) => void;
  /** Render the plan markdown (default: Peacock Markdown; desktop linkifies). */
  renderMarkdown?: (text: string, className?: string) => ReactNode;
  /** Persist feedback across view switches. Omit for none. */
  drafts?: PlanApprovalDrafts;
}

/**
 * ExitPlanMode approval — renders the proposed plan with Approve / Keep planning
 * actions and a feedback box that refines the plan (sent back as a deny
 * message). Pure: markdown rendering and draft persistence are injected.
 */
export function PlanApproval({
  plan,
  onApprove,
  onApproveInNewSession,
  onReject,
  onSubmitFeedback,
  renderMarkdown,
  drafts,
}: PlanApprovalProps) {
  const [feedback, setFeedback] = useState<string>(
    () => drafts?.get()?.feedback ?? "",
  );
  const [expanded, setExpanded] = useState(false);

  const renderPlan = useCallback(
    (className: string) =>
      renderMarkdown ? (
        renderMarkdown(plan, className)
      ) : (
        <Markdown className={className} text={plan} />
      ),
    [renderMarkdown, plan],
  );

  const persist = useCallback(
    (next: string) => {
      setFeedback(next);
      drafts?.set({ feedback: next });
    },
    [drafts],
  );

  const handleApprove = useCallback(() => {
    drafts?.clear();
    onApprove();
  }, [onApprove, drafts]);

  const handleApproveInNewSession = useCallback(() => {
    drafts?.clear();
    onApproveInNewSession?.();
  }, [onApproveInNewSession, drafts]);

  const handleSend = useCallback(() => {
    const trimmed = feedback.trim();
    if (!trimmed) {
      return;
    }
    onSubmitFeedback(trimmed);
    setFeedback("");
    setExpanded(false);
    drafts?.clear();
  }, [feedback, onSubmitFeedback, drafts]);

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
        onChange={(e) => persist(e.target.value)}
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
      {onApproveInNewSession && (
        <button
          className={styles.secondaryBtn}
          onClick={handleApproveInNewSession}
          title="Create a new session in this project seeded with this plan"
          type="button"
        >
          Approve in new session
        </button>
      )}
      <button className={styles.rejectBtn} onClick={onReject}>
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
          <EnlargeIcon size={12} />
        </button>
      </div>
      {renderPlan(styles.plan)}
      {feedbackBlock}
      {actionsBlock}
      {expanded && (
        <Dialog
          onClose={() => setExpanded(false)}
          size="full"
          title="Proposed plan"
          titleId="plan-approval-dialog"
        >
          <DialogBody className={styles.dialogBody}>
            {renderPlan(styles.dialogPlan)}
            {feedbackBlock}
            {actionsBlock}
          </DialogBody>
        </Dialog>
      )}
    </div>
  );
}
