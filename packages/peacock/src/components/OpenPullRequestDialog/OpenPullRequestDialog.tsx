import { useId } from "react";
import { AgentIcon, CheckIcon, CopyIcon, PopoutIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import { Input, TextArea } from "../Input/Input";
import { Select } from "../Select/Select";
import { Toggle } from "../Toggle/Toggle";
import styles from "./OpenPullRequestDialog.module.css";

export interface OpenPullRequestBranches {
  base: string;
  head: string;
  /** Local branches to pick either side from. */
  options: string[];
  onBaseChange: (branch: string) => void;
  onHeadChange: (branch: string) => void;
}

export interface OpenPullRequestChoice {
  value: string;
  label: string;
}

export interface OpenPullRequestDialogProps {
  title: string;
  onTitleChange: (title: string) => void;
  body: string;
  onBodyChange: (body: string) => void;
  draft: boolean;
  onDraftChange: (draft: boolean) => void;
  /** Base and head pickers, when the caller decides them. */
  branches?: OpenPullRequestBranches;
  /** "feature → main", when the computer decides them instead. */
  route?: string | null;
  /** More than one offers a picker of what to open it for. */
  choices?: OpenPullRequestChoice[];
  choice?: string;
  onChoiceChange?: (value: string) => void;
  onFill?: () => void;
  filling?: boolean;
  fillLabel?: string;
  error?: string | null;
  /** Worded by the caller: "Pushing branch…", "Push and open draft", … */
  submitLabel: string;
  submitting?: boolean;
  onSubmit: () => void;
  /** Once opened: the PR's link, and ways to follow it. */
  created?: { url: string; onOpen: () => void; onCopy?: () => void } | null;
  onClose: () => void;
}

/**
 * Open a pull request: a title, a description (started from the repo's
 * template, or filled in by Claude), draft, then push and open.
 */
export function OpenPullRequestDialog({
  title,
  onTitleChange,
  body,
  onBodyChange,
  draft,
  onDraftChange,
  branches,
  route,
  choices = [],
  choice,
  onChoiceChange,
  onFill,
  filling = false,
  fillLabel = "Fill in with Claude",
  error,
  submitLabel,
  submitting = false,
  onSubmit,
  created,
  onClose,
}: OpenPullRequestDialogProps) {
  const id = useId();
  const busy = submitting || filling;

  if (created) {
    return (
      <Dialog
        title="Pull request opened"
        titleId={id}
        onClose={onClose}
        size="medium"
      >
        <DialogBody>
          <div className={styles.created}>
            <span className={styles.createdTitle}>
              <CheckIcon size={14} />
              Opened on GitHub
            </span>
            <span className={styles.createdUrl}>{created.url}</span>
            <div className={styles.createdActions}>
              <Button
                variant="primary"
                size="sm"
                leading={<PopoutIcon size={12} />}
                onClick={created.onOpen}
              >
                Open on GitHub
              </Button>
              {created.onCopy && (
                <Button
                  variant="secondary"
                  size="sm"
                  leading={<CopyIcon size={12} />}
                  onClick={created.onCopy}
                >
                  Copy link
                </Button>
              )}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Open pull request"
      titleId={id}
      onClose={onClose}
      size="medium"
    >
      <DialogBody>
        {choices.length > 1 && onChoiceChange && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-choice`}>
              Session
            </label>
            <Select
              id={`${id}-choice`}
              value={choice}
              onChange={(e) => onChoiceChange(e.target.value)}
              disabled={busy}
            >
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-title`}>
            Title
          </label>
          <Input
            id={`${id}-title`}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Pull request title"
            disabled={busy}
            autoFocus
          />
          {route && <span className={styles.route}>{route}</span>}
        </div>

        <div className={styles.field}>
          <div className={styles.descriptionHeader}>
            <label className={styles.label} htmlFor={`${id}-body`}>
              Description
            </label>
            {onFill && (
              <Button
                variant="secondary"
                size="sm"
                leading={<AgentIcon size={12} />}
                disabled={busy}
                onClick={onFill}
              >
                {filling ? "Filling in…" : fillLabel}
              </Button>
            )}
          </div>
          <TextArea
            id={`${id}-body`}
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder="What changed and why"
            rows={8}
            disabled={busy}
          />
        </div>

        {branches && (
          <div className={styles.branchRow}>
            <BranchSelect
              id={`${id}-base`}
              label="Base branch"
              value={branches.base}
              options={branches.options}
              disabled={busy}
              onChange={branches.onBaseChange}
            />
            <BranchSelect
              id={`${id}-head`}
              label="Head branch"
              value={branches.head}
              options={branches.options}
              disabled={busy}
              onChange={branches.onHeadChange}
            />
          </div>
        )}

        <div className={styles.draftRow}>
          <div>
            <div className={styles.draftLabel}>Draft pull request</div>
            <div className={styles.draftSub}>
              Mark as draft to signal it is not ready for review
            </div>
          </div>
          <Toggle checked={draft} onChange={onDraftChange} disabled={busy} />
        </div>

        {error && <p className={styles.error}>{error}</p>}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={busy || title.trim().length === 0}
        >
          {submitLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function BranchSelect({
  disabled,
  id,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
        {!options.includes(value) && <option value={value}>{value}</option>}
      </Select>
    </div>
  );
}
