import type { KeyboardEvent, ReactNode } from "react";
import { useState } from "react";
import { ArrowUpRightIcon, PlayIcon, TrashIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { ConfidenceMeter } from "../ConfidenceMeter/ConfidenceMeter";
import { Input } from "../Input/Input";
import { Markdown } from "../Markdown/Markdown";
import styles from "./ProposalCard.module.css";

export interface ProposalCardAction {
  /**
   * `start` spins up work, `open` sends the user somewhere, `destroy` deletes
   * something — and so asks once more before it runs.
   */
  kind: "destroy" | "open" | "start";
  label: string;
  onClick: () => void;
  /** What the confirm step says it is about to do. Required for `destroy`. */
  confirm?: string;
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
   * Hand the note back to the automation instead of to an agent: the proposal
   * is close but not right, and the next run should do better. Omit and the
   * note can only be used to start.
   */
  onRequestRevision?: (note: string) => void;
  /**
   * Start the proposal with a note appended to the agent's brief. Omit when
   * there is nothing to start — the note has nowhere to go.
   */
  onStartWithNote?: (note: string) => void;
  /**
   * The one action the proposal is asking for. Omit it when there is nothing
   * to do but dismiss — an offer to start work that does not exist is worse
   * than no button.
   */
  primary?: ProposalCardAction;
  /** Why the run ranked it where it did. Shown under the summary. */
  rationale?: string;
  /** A revision already asked for, shown so a second ask is an informed one. */
  revisionRequest?: string;
  /** Render the markdown body (default: Peacock Markdown; desktop linkifies). */
  renderMarkdown?: (text: string, className?: string) => ReactNode;
  /** External work item this came from, e.g. `plexinc/app#412`. */
  sourceLabel?: string;
  summary: string;
  title: string;
}

function PrimaryIcon({ kind }: { kind: ProposalCardAction["kind"] }) {
  if (kind === "start") {
    return <PlayIcon size={11} />;
  }

  return kind === "destroy" ? (
    <TrashIcon size={11} />
  ) : (
    <ArrowUpRightIcon size={11} />
  );
}

/**
 * One thing an automation wants you to decide on. Yes, no, and the answer most
 * proposals actually deserve: yes but — a note that either rides along into
 * the agent's brief or goes back to the automation as the revision to make.
 * Every field is inline, never a dialog: a note that costs a dialog does not
 * get written, and the note is the whole signal.
 */
export function ProposalCard({
  busy,
  confidence,
  decided,
  meta,
  onDismiss,
  onOpenSource,
  onRequestRevision,
  onStartWithNote,
  primary,
  rationale,
  renderMarkdown,
  revisionRequest,
  sourceLabel,
  summary,
  title,
}: ProposalCardProps) {
  const render = (text: string, className: string) =>
    renderMarkdown ? (
      renderMarkdown(text, className)
    ) : (
      <Markdown className={className} text={text} />
    );

  const [dismissing, setDismissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [noting, setNoting] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const confirmDismiss = () => {
    setDismissing(false);
    onDismiss(reason.trim());
    setReason("");
  };

  const canNote = onStartWithNote != null || onRequestRevision != null;
  const trimmedNote = note.trim();

  const submitNote = (send: ((note: string) => void) | undefined) => {
    if (!send || !trimmedNote) {
      return;
    }
    setNoting(false);
    setNote("");
    send(trimmedNote);
  };

  const noteKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitNote(onStartWithNote ?? onRequestRevision);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setNoting(false);
    }
  };

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <ConfidenceMeter value={confidence} />
      </header>

      {render(summary, styles.summary)}
      {rationale && render(rationale, styles.rationale)}

      {meta != null && <div className={styles.meta}>{meta}</div>}

      {revisionRequest && (
        <p className={styles.revision}>
          You asked for a better one: {revisionRequest}
        </p>
      )}

      {decided != null && <p className={styles.decided}>{decided}</p>}

      {decided == null && confirming && primary && (
        <div className={styles.dismissRow}>
          <span className={styles.confirmText}>
            {primary.confirm ?? "This cannot be undone."}
          </span>
          <Button
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              primary.onClick();
            }}
            size="sm"
            variant="danger"
          >
            {primary.label}
          </Button>
          <Button
            disabled={busy}
            onClick={() => setConfirming(false)}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </div>
      )}

      {decided == null && !confirming && !dismissing && noting && (
        <div className={styles.noteRow}>
          <textarea
            aria-label="Add a note to this proposal"
            autoFocus
            className={styles.note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={noteKeyDown}
            placeholder={
              onStartWithNote
                ? "Mostly right, but… — ⌘↵ to start with this note"
                : "What should the next proposal do differently?"
            }
            rows={2}
            value={note}
          />
          <div className={styles.noteActions}>
            {onStartWithNote && (
              <Button
                disabled={busy || !trimmedNote}
                leading={<PlayIcon size={11} />}
                onClick={() => submitNote(onStartWithNote)}
                size="sm"
                variant="primary"
              >
                Start with this note
              </Button>
            )}
            {onRequestRevision && (
              <Button
                disabled={busy || !trimmedNote}
                onClick={() => submitNote(onRequestRevision)}
                size="sm"
                title="Keeps it in the inbox and asks the automation to redo it"
                variant="secondary"
              >
                Ask for a better one
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => setNoting(false)}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {decided == null && !confirming && !noting && dismissing && (
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

      {decided == null && !dismissing && !confirming && !noting && (
        <div className={styles.actions}>
          {primary && (
            <Button
              disabled={busy}
              leading={<PrimaryIcon kind={primary.kind} />}
              onClick={() =>
                primary.kind === "destroy"
                  ? setConfirming(true)
                  : primary.onClick()
              }
              size="sm"
              variant={primary.kind === "destroy" ? "danger" : "primary"}
            >
              {primary.label}
            </Button>
          )}
          {canNote && (
            <Button
              disabled={busy}
              onClick={() => setNoting(true)}
              size="sm"
              variant="secondary"
            >
              Add a note
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
