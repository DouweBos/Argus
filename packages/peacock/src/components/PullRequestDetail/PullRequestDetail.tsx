/**
 * The pieces of one pull request's screen: header, tabs, checks, the
 * conversation, a comment box and the merge split button. Data comes in as
 * view models plus callbacks, so the desktop (`gh` over IPC) and the web
 * client (the gateway) compose the same screen.
 */

import { type ReactNode, useRef, useState } from "react";
import {
  AgentIcon,
  BranchIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CloseIcon,
  FileIcon,
  MergeIcon,
  MinusIcon,
  PopoutIcon,
} from "../../icons/Icons";
import { Badge, type BadgeTone } from "../Badge/Badge";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { Card } from "../Card/Card";
import { Chip } from "../Chip/Chip";
import { ContextMenu } from "../ContextMenu/ContextMenu";
import { DiffStat } from "../DiffStat/DiffStat";
import { TextArea } from "../Input/Input";
import styles from "./PullRequestDetail.module.css";

export type PullRequestCheckTone = "error" | "neutral" | "success" | "warning";

export function PullRequestCheckIcon({ tone }: { tone: PullRequestCheckTone }) {
  switch (tone) {
    case "success":
      return (
        <span className={`${styles.checkIcon} ${styles.checkSuccess}`}>
          <CheckIcon size={10} />
        </span>
      );
    case "error":
      return (
        <span className={`${styles.checkIcon} ${styles.checkFailure}`}>
          <CloseIcon size={10} />
        </span>
      );
    case "warning":
      return (
        <span className={`${styles.checkIcon} ${styles.checkPending}`}>
          <ClockIcon size={10} />
        </span>
      );
    default:
      return (
        <span className={`${styles.checkIcon} ${styles.checkNeutral}`}>
          <MinusIcon size={10} />
        </span>
      );
  }
}

/** "View on GitHub ↗" beside a section title. */
export function PullRequestSectionLink({
  children,
  label,
  onClick,
}: {
  children?: ReactNode;
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.sectionLink}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
      <PopoutIcon size={10} />
    </button>
  );
}

export function PullRequestEmptyLine({ children }: { children: ReactNode }) {
  return <p className={styles.emptyLine}>{children}</p>;
}

export interface PullRequestHeaderProps {
  state: { label: string; tone: BadgeTone };
  author: string | null;
  avatarUrl?: string | null;
  headRef: string;
  baseRef: string;
  /** "3h ago". */
  updated?: string | null;
  commits?: number | null;
  changedFiles: number;
  additions: number;
  deletions: number;
  labels?: string[];
  /** GitHub says the branch conflicts with its base. */
  conflicting?: boolean;
  /** Open in browser, refresh, merge, … */
  actions?: ReactNode;
}

export function PullRequestHeader({
  state,
  author,
  avatarUrl,
  headRef,
  baseRef,
  updated,
  commits,
  changedFiles,
  additions,
  deletions,
  labels = [],
  conflicting = false,
  actions,
}: PullRequestHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerTop}>
        <div className={styles.titleBlock}>
          <div className={styles.subLine}>
            <Badge tone={state.tone} size="tag">
              {state.label}
            </Badge>
            {avatarUrl && (
              <img alt="" className={styles.subAvatar} src={avatarUrl} />
            )}
            <span>
              {author ?? "unknown"} wants to merge <code>{headRef}</code> into{" "}
              <code>{baseRef}</code>
            </span>
            {updated && (
              <>
                <span>·</span>
                <span>updated {updated}</span>
              </>
            )}
          </div>
        </div>
        {actions && <div className={styles.actionRow}>{actions}</div>}
      </div>
      <div className={styles.stats}>
        {commits != null && (
          <span className={styles.statItem}>
            <BranchIcon size={12} />
            <strong>{commits}</strong> commit{commits === 1 ? "" : "s"}
          </span>
        )}
        <span className={styles.statItem}>
          <FileIcon size={12} />
          <strong>{changedFiles}</strong> file{changedFiles === 1 ? "" : "s"}{" "}
          changed
        </span>
        <span className={styles.statItem}>
          <DiffStat added={additions} removed={deletions} />
        </span>
        {labels.length > 0 && (
          <span className={styles.labels}>
            {labels.map((name) => (
              <Chip key={name} muted>
                {name}
              </Chip>
            ))}
          </span>
        )}
      </div>
      {conflicting && (
        <Banner tone="warning">This branch conflicts with its base.</Banner>
      )}
    </header>
  );
}

export interface PullRequestTab<T extends string> {
  id: T;
  label: ReactNode;
}

export function PullRequestTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: PullRequestTab<T>[];
  value: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label="Pull request sections"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={`${styles.tab} ${value === t.id ? styles.tabActive : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export interface PullRequestCheck {
  name: string;
  tone: PullRequestCheckTone;
  /** The status context's words, or GitHub's conclusion. */
  description?: string | null;
  url?: string | null;
}

export interface PullRequestChecksSummaryModel {
  title: string;
  tone: "error" | "success" | "warning";
  passed: number;
  failed: number;
  pending: number;
  total: number;
}

function CheckRow({
  check,
  onOpenUrl,
}: {
  check: PullRequestCheck;
  onOpenUrl?: (url: string) => void;
}) {
  const url = check.url;
  const open = url && onOpenUrl ? () => onOpenUrl(url) : undefined;

  return (
    <div
      className={styles.checkRow}
      role={open ? "button" : undefined}
      tabIndex={open ? 0 : undefined}
      onClick={open}
      onKeyDown={(e) => {
        if (open && e.key === "Enter") {
          open();
        }
      }}
    >
      <PullRequestCheckIcon tone={check.tone} />
      <span className={styles.checkName}>{check.name}</span>
      {check.description && (
        <span className={styles.checkDesc}>{check.description}</span>
      )}
      {open && <PopoutIcon size={10} />}
    </div>
  );
}

/** Every check, one row each. */
export function PullRequestCheckList({
  checks,
  onOpenUrl,
}: {
  checks: PullRequestCheck[];
  onOpenUrl?: (url: string) => void;
}) {
  if (checks.length === 0) {
    return <PullRequestEmptyLine>No checks reported.</PullRequestEmptyLine>;
  }

  return (
    <div className={styles.checksSummaryRows}>
      {checks.map((check, i) => (
        <CheckRow
          key={`${check.name}-${i}`}
          check={check}
          onOpenUrl={onOpenUrl}
        />
      ))}
    </div>
  );
}

/** The status strip under the conversation: how CI stands, the first few checks. */
export function PullRequestChecksSummary({
  checks,
  summary,
  onOpenDetails,
  onOpenUrl,
  limit = 6,
}: {
  checks: PullRequestCheck[];
  summary: PullRequestChecksSummaryModel;
  onOpenDetails?: () => void;
  onOpenUrl?: (url: string) => void;
  limit?: number;
}) {
  return (
    <div className={styles.checksSummaryWrap}>
      <Card
        className={`${styles.checksSummary} ${styles[`summary_${summary.tone}`]}`}
      >
        <div className={styles.checksSummaryHead}>
          <span className={styles.checksSummaryTitle}>{summary.title}</span>
          <span className={styles.checksSummarySub}>
            {summary.passed} passing · {summary.failed} failing ·{" "}
            {summary.pending} pending · {summary.total} total
          </span>
          {onOpenDetails && (
            <PullRequestSectionLink onClick={onOpenDetails}>
              Details
            </PullRequestSectionLink>
          )}
        </div>
        <div className={styles.checksSummaryRows}>
          {checks.slice(0, limit).map((check, i) => (
            <CheckRow
              key={`${check.name}-${i}`}
              check={check}
              onOpenUrl={onOpenUrl}
            />
          ))}
          {checks.length > limit && (
            <PullRequestEmptyLine>
              + {checks.length - limit} more — see the Checks tab.
            </PullRequestEmptyLine>
          )}
        </div>
      </Card>
    </div>
  );
}

export interface PullRequestTimelineEntry {
  id: string;
  author: string | null;
  avatarUrl?: string | null;
  /** A review's verdict ("Approved"); absent for a plain comment. */
  review?: string | null;
  age: string;
  url?: string | null;
  /** Rendered by the caller: GitHub's HTML on the desktop, Markdown on the web. */
  body: ReactNode | null;
  /** Per-line comments a review carries. */
  inline?: { id: string; age: string; url?: string | null; body: ReactNode }[];
}

/** The conversation, GitHub-style: one line behind every avatar. */
export function PullRequestTimeline({
  entries,
  onOpenUrl,
}: {
  entries: PullRequestTimelineEntry[];
  onOpenUrl?: (url: string) => void;
}) {
  if (entries.length === 0) {
    return <PullRequestEmptyLine>No comments yet.</PullRequestEmptyLine>;
  }
  const link = (url: string | null | undefined, label: string) =>
    url && onOpenUrl ? (
      <PullRequestSectionLink label={label} onClick={() => onOpenUrl(url)} />
    ) : null;

  return (
    <ol className={styles.timeline}>
      {entries.map((c) => (
        <li key={c.id} className={styles.timelineItem}>
          <div className={styles.timelineAvatar}>
            {c.avatarUrl ? (
              <img alt="" src={c.avatarUrl} />
            ) : (
              <AgentIcon size={14} />
            )}
          </div>
          <Card className={styles.commentRow}>
            <div className={styles.commentHead}>
              <span className={styles.commentAuthor}>
                {c.author ?? "unknown"}
              </span>
              {c.review && (
                <Badge tone="accent" size="tag">
                  {c.review}
                </Badge>
              )}
              <span>· {c.age}</span>
              {link(c.url, "View on GitHub")}
            </div>
            {c.body}
            {c.inline && c.inline.length > 0 && (
              <ul className={styles.inlineThread}>
                {c.inline.map((ic) => (
                  <li key={ic.id} className={styles.inlineItem}>
                    <div className={styles.inlineHead}>
                      <span>{ic.age}</span>
                      {link(ic.url, "View inline comment on GitHub")}
                    </div>
                    {ic.body}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </li>
      ))}
    </ol>
  );
}

/** Leave a comment; clears once `onSubmit` resolves, shows why when it throws. */
export function PullRequestCommentBox({
  onSubmit,
  disabled = false,
}: {
  onSubmit: (body: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  };

  return (
    <div className={styles.composerWrap}>
      <TextArea
        ref={textareaRef}
        className={styles.composerTextarea}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment…"
        rows={3}
        disabled={submitting || disabled}
      />
      {error && <p className={styles.composerError}>{error}</p>}
      <div className={styles.composerFooter}>
        <Button
          variant="primary"
          size="sm"
          disabled={submitting || disabled || !body.trim()}
          onClick={() => {
            submit().catch(() => {});
          }}
        >
          {submitting ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}

export interface MergeSplitButtonProps<T extends string> {
  strategy: T;
  options: { value: T; label: string }[];
  onStrategyChange: (strategy: T) => void;
  onMerge: () => void;
  merging?: boolean;
  disabled?: boolean;
}

/** GitHub's split button: the remembered strategy, the others behind the chevron. */
export function MergeSplitButton<T extends string>({
  strategy,
  options,
  onStrategyChange,
  onMerge,
  merging = false,
  disabled = false,
}: MergeSplitButtonProps<T>) {
  const splitRef = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const label = options.find((o) => o.value === strategy)?.label ?? strategy;

  return (
    <span className={styles.split} ref={splitRef}>
      <Button
        variant="primary"
        size="sm"
        leading={<MergeIcon size={12} />}
        disabled={disabled || merging}
        onClick={onMerge}
        className={styles.splitMain}
      >
        {merging ? "Merging…" : label}
      </Button>
      <Button
        variant="primary"
        size="sm"
        aria-label="Merge strategy"
        aria-haspopup="menu"
        title="Merge strategy"
        disabled={disabled || merging}
        className={styles.splitChevron}
        onClick={() => {
          const rect = splitRef.current?.getBoundingClientRect();
          if (rect) {
            setMenu({ x: rect.right - 220, y: rect.bottom + 4 });
          }
        }}
      >
        <ChevronDownIcon size={10} />
      </Button>
      {menu && (
        <ContextMenu
          position={menu}
          width={220}
          triggerRef={splitRef}
          onClose={() => setMenu(null)}
          items={options.map((o) => ({
            label: o.label,
            selected: o.value === strategy,
            onClick: () => onStrategyChange(o.value),
          }))}
        />
      )}
    </span>
  );
}
