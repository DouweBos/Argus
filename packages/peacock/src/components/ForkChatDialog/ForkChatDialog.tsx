import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import { Input, TextArea } from "../Input/Input";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import styles from "./ForkChatDialog.module.css";

/** A new session branched at the message, or a new agent in this one. */
export type ForkTarget = "agent" | "session";

export interface ForkChatRequest {
  into: ForkTarget;
  /** Trimmed; empty for a fork into a new agent. */
  description: string;
  /** Trimmed as typed; empty to name it from the description. */
  branch: string;
}

export interface BranchNote {
  hint: ReactNode;
  /** The branch can't be used (it exists already). */
  blocked?: boolean;
}

export interface ForkChatDialogProps {
  onClose: () => void;
  /** Rejects with the reason to show; the dialog stays open. */
  onSubmit: (request: ForkChatRequest) => Promise<void>;
  /** What the branch field resolves to, shown under it. */
  describeBranch?: (branch: string, description: string) => BranchNote | null;
  /** Under the branch field, e.g. a personal branch prefix. */
  branchFooter?: ReactNode;
}

function reason(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return typeof err === "string" ? err : "Couldn't fork the chat.";
}

/** Fork the chat up to a message into a new agent: in a new session branched there, or beside this one. */
export function ForkChatDialog({
  onClose,
  onSubmit,
  describeBranch,
  branchFooter,
}: ForkChatDialogProps) {
  const [into, setInto] = useState<ForkTarget>("session");
  const [description, setDescription] = useState("");
  const [branch, setBranch] = useState("");
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedDescription = description.trim();
  const note =
    into === "session"
      ? (describeBranch?.(branch.trim(), trimmedDescription) ?? null)
      : null;
  const canSubmit =
    !forking && (into === "agent" || (!!trimmedDescription && !note?.blocked));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) {
      return;
    }
    setForking(true);
    setError(null);
    try {
      await onSubmit({
        into,
        description: into === "session" ? trimmedDescription : "",
        branch: into === "session" ? branch.trim() : "",
      });
      onClose();
    } catch (err) {
      setError(reason(err));
    } finally {
      setForking(false);
    }
  };

  let submitLabel = "Fork into new session";
  if (forking) {
    submitLabel = "Forking…";
  } else if (into === "agent") {
    submitLabel = "Fork into new agent";
  }

  return (
    <Dialog
      size="medium"
      title="Fork chat"
      titleId="fork-chat-title"
      onClose={onClose}
    >
      <DialogBody as="form" id="fork-chat-form" onSubmit={submit}>
        <div className={styles.field}>
          <SegmentedControl
            aria-label="Fork target"
            options={[
              { value: "session", label: "New session" },
              { value: "agent", label: "New agent here" },
            ]}
            value={into}
            onChange={setInto}
          />
          <span className={styles.hint}>
            {into === "session"
              ? "A fresh worktree branched from this point, with the chat up to this message."
              : "A new agent in this session's worktree, with the chat up to this message."}
          </span>
        </div>

        {into === "session" && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="fork-chat-description">
                Description
              </label>
              <TextArea
                autoFocus
                id="fork-chat-description"
                placeholder="What's this fork for?"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    submit().catch(() => {});
                  }
                }}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="fork-chat-branch">
                Branch name{" "}
                <span className={styles.labelHint}>
                  (optional — generated from description)
                </span>
              </label>
              <Input
                autoComplete="off"
                id="fork-chat-branch"
                placeholder="e.g. feat/my-feature"
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
              {note && (
                <span className={note.blocked ? styles.blocked : styles.hint}>
                  {note.hint}
                </span>
              )}
              {branchFooter}
            </div>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!canSubmit}
          form="fork-chat-form"
          type="submit"
          variant="primary"
        >
          {submitLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
