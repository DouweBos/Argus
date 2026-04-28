import { useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import styles from "./FeedbackDialog.module.css";

export type FeedbackSubmitState = "error" | "idle" | "sending" | "sent";

export interface FeedbackDialogProps {
  /**
   * Async submit handler. Receives the trimmed feedback text. Throwing or
   * rejecting flips the dialog into the error state.
   */
  onClose: () => void;
  onSubmit: (message: string) => Promise<void> | void;
  /**
   * When set, the dialog shows a warning banner with this reason and
   * disables submit. Use this when the caller knows up front that the
   * feedback channel can't deliver (e.g. telemetry opted out, no API key).
   */
  unavailableReason?: string | null;
}

/**
 * Free-form user feedback dialog. Captures a single multi-line message and
 * passes it to `onSubmit`. The caller decides where the message goes (e.g.
 * a `posthog.capture('user_feedback', …)` event).
 *
 * No name, email, or other identifying field is collected — this dialog
 * is intentionally anonymous to match Argus's telemetry posture.
 */
export function FeedbackDialog({
  onClose,
  onSubmit,
  unavailableReason,
}: FeedbackDialogProps) {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<FeedbackSubmitState>("idle");

  const trimmed = message.trim();
  const canSubmit =
    trimmed.length > 0 && state !== "sending" && !unavailableReason;

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setState("sending");
    try {
      await onSubmit(trimmed);
      setState("sent");
      setMessage("");
      // Auto-close shortly after a successful submit.
      setTimeout(onClose, 800);
    } catch {
      setState("error");
    }
  };

  return (
    <Dialog
      onClose={onClose}
      title="Send feedback"
      titleId="feedback-dialog-title"
    >
      <div className={styles.body}>
        {unavailableReason && (
          <div className={styles.warning} role="alert">
            {unavailableReason}
          </div>
        )}
        <p className={styles.intro}>
          Found a bug, have a request, or just want to share what is or
          isn&apos;t working? We read everything.
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="feedback-dialog-message">
            Your feedback
          </label>
          <textarea
            autoFocus
            className={styles.textarea}
            disabled={state === "sending"}
            id="feedback-dialog-message"
            placeholder="What's on your mind?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <p className={styles.privacy}>
          Sent anonymously alongside your install id, app version, and OS.
          Nothing about your projects, prompts, or files is included.
        </p>
      </div>
      <div className={styles.footer}>
        {state === "error" && (
          <span className={`${styles.status} ${styles.statusError}`}>
            Couldn&apos;t send. Try again?
          </span>
        )}
        {state === "sent" && (
          <span className={`${styles.status} ${styles.statusSuccess}`}>
            Thanks — sent.
          </span>
        )}
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={state === "sending"}
        >
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
          {state === "sending" ? "Sending…" : "Send"}
        </Button>
      </div>
    </Dialog>
  );
}
