import type { KeyboardEvent, ReactNode } from "react";
import { CheckIcon, GuestsIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import {
  CommitComposer,
  type CommitComposerCommit,
  type CommitComposerFile,
} from "../CommitComposer/CommitComposer";
import styles from "./CommitForm.module.css";

export interface CommitFormOptions {
  amend: boolean;
  signOff: boolean;
  sign: boolean;
}

export interface CommitFormProps {
  summary: string;
  description: string;
  onSummaryChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  options: CommitFormOptions;
  /** Amend is passed separately: turning it on may refill the fields. */
  onAmendChange?: (amend: boolean) => void;
  onOptionsChange: (options: CommitFormOptions) => void;
  /** Offers folding the changes into the last commit. */
  allowsAmend?: boolean;
  /** A signing key is configured, so "Sign" can work. */
  canSign?: boolean;
  /** Who the commit is authored as, `Name <email>`. */
  identity?: string | null;
  /** "3 changed files · +12 −4". */
  changeSummary: ReactNode;
  committing?: boolean;
  disabled?: boolean;
  onCommit: () => void;
  recentCommits?: CommitComposerCommit[];
  diffFiles?: CommitComposerFile[];
}

function OptionChip({
  disabled,
  label,
  on,
  onToggle,
  title,
}: {
  disabled: boolean;
  label: string;
  on: boolean;
  onToggle: () => void;
  title?: string;
}) {
  const toggle = () => {
    if (!disabled) {
      onToggle();
    }
  };

  return (
    <Chip
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      title={title}
      interactive={!disabled}
      selected={on}
      leading={on ? <CheckIcon size={10} /> : undefined}
      onClick={toggle}
      onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {label}
    </Chip>
  );
}

/**
 * Summary and description over a slim strip of options — Amend, Sign off and
 * Sign as chips, and who the commit is authored as — then the commit button.
 * The Mac's and the phone's commit composer; fields come from `CommitComposer`.
 */
export function CommitForm({
  summary,
  description,
  onSummaryChange,
  onDescriptionChange,
  options,
  onAmendChange,
  onOptionsChange,
  allowsAmend = false,
  canSign = false,
  identity,
  changeSummary,
  committing = false,
  disabled = false,
  onCommit,
  recentCommits,
  diffFiles,
}: CommitFormProps) {
  const locked = disabled || committing;
  const canCommit = summary.trim().length > 0 && !locked;
  let label = options.amend ? "Amend" : "Commit all";
  if (committing) {
    label = "Committing…";
  }

  return (
    <div className={styles.form}>
      <div className={styles.fields}>
        <CommitComposer
          subject={summary}
          body={description}
          onSubjectChange={onSummaryChange}
          onBodyChange={onDescriptionChange}
          showBody
          subjectPlaceholder="Summary"
          bodyPlaceholder="Description"
          disabled={locked}
          recentCommits={recentCommits}
          diffFiles={diffFiles}
        />
      </div>
      <div className={styles.options}>
        {allowsAmend && (
          <OptionChip
            label="Amend"
            on={options.amend}
            disabled={locked}
            title="Fold the changes into the last commit"
            onToggle={() =>
              onAmendChange
                ? onAmendChange(!options.amend)
                : onOptionsChange({ ...options, amend: !options.amend })
            }
          />
        )}
        <OptionChip
          label="Sign off"
          on={options.signOff}
          disabled={locked}
          title="Adds a Signed-off-by trailer"
          onToggle={() =>
            onOptionsChange({ ...options, signOff: !options.signOff })
          }
        />
        {canSign && (
          <OptionChip
            label="Sign"
            on={options.sign}
            disabled={locked}
            title="Signs the commit with the computer's key"
            onToggle={() =>
              onOptionsChange({ ...options, sign: !options.sign })
            }
          />
        )}
        {identity && (
          <Chip
            muted
            leading={<GuestsIcon size={10} />}
            title={`Commits as ${identity}`}
            className={styles.identity}
          >
            {identity}
          </Chip>
        )}
      </div>
      <div className={styles.footer}>
        <span className={styles.summary}>{changeSummary}</span>
        <Button
          variant="primary"
          size="sm"
          leading={<CheckIcon size={12} />}
          disabled={!canCommit}
          onClick={onCommit}
        >
          {label}
        </Button>
      </div>
    </div>
  );
}
