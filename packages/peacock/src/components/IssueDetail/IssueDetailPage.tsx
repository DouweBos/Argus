import type { LinearIssue } from "@argus/remote-protocol";
import { type ReactNode, useEffect } from "react";
import {
  ArrowUpRightIcon,
  BranchIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CopyIcon,
  LinkIcon,
  WarningIcon,
} from "../../icons/Icons";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { Spinner } from "../Spinner/Spinner";
import styles from "./IssueDetail.module.css";

export interface IssueDetailPageProps {
  /** The properties sidebar, once the issue is loaded. */
  aside?: ReactNode;
  /** The body and activity, once the issue is loaded. */
  children?: ReactNode;
  error: string | null;
  issue: Pick<
    LinearIssue,
    "branchName" | "identifier" | "title" | "url"
  > | null;
  issueRef: string;
  /** "Assigned to me": the list it was opened from, for the breadcrumb. */
  listTitle: string;
  onClose: () => void;
  onOpen: (identifier: string) => void;
  onOpenExternal: (url: string) => void;
  /** The list's order, for previous/next. */
  order: string[];
}

function copyText(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {});
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest("input, textarea, [contenteditable]")
  );
}

/** The whole ticket as a page, the way Linear shows it. */
export function IssueDetailPage({
  aside,
  children,
  error,
  issue,
  issueRef,
  listTitle,
  onClose,
  onOpen,
  onOpenExternal,
  order,
}: IssueDetailPageProps) {
  const index = order.indexOf(issueRef);

  // j/k walk the list like Linear's arrows; Escape goes back to it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "j" && index >= 0 && index < order.length - 1) {
        onOpen(order[index + 1]);
      } else if (e.key === "k" && index > 0) {
        onOpen(order[index - 1]);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, onOpen, order]);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.crumb} type="button" onClick={onClose}>
          {listTitle}
        </button>
        <ChevronRightIcon size={8} />
        <span className={styles.crumbCurrent}>
          <span className={styles.mono}>{issueRef}</span>
          {issue && <span className={styles.rowTitle}>{issue.title}</span>}
        </span>
        <span className={styles.topBarSpacer} />
        {issue && (
          <span className={styles.copyActions}>
            <Button
              variant="ghost"
              size="sm"
              title="Copy link"
              aria-label="Copy link"
              onClick={() => copyText(issue.url)}
            >
              <LinkIcon size={12} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Copy ID"
              aria-label="Copy ID"
              onClick={() => copyText(issue.identifier)}
            >
              <CopyIcon size={12} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Copy branch name"
              aria-label="Copy branch name"
              onClick={() => copyText(issue.branchName)}
            >
              <BranchIcon size={12} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Open in Linear"
              aria-label="Open in Linear"
              onClick={() => onOpenExternal(issue.url)}
            >
              <ArrowUpRightIcon size={12} />
            </Button>
          </span>
        )}
        {index >= 0 && (
          <span className={styles.nav}>
            <span className={styles.muted}>
              {index + 1} / {order.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              title="Next issue (j)"
              aria-label="Next issue"
              disabled={index >= order.length - 1}
              onClick={() => onOpen(order[index + 1])}
            >
              <ChevronDownIcon size={10} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Previous issue (k)"
              aria-label="Previous issue"
              disabled={index <= 0}
              onClick={() => onOpen(order[index - 1])}
            >
              <ChevronUpIcon size={10} />
            </Button>
          </span>
        )}
      </div>

      {!issue && error && (
        <EmptyState
          icon={<WarningIcon size={20} />}
          title="Couldn't load the issue"
          body={error}
        />
      )}
      {!issue && !error && (
        <EmptyState icon={<Spinner size="md" />} title="Loading issue" />
      )}
      {issue && (
        <div className={styles.layout}>
          <main className={styles.main}>{children}</main>
          {aside}
        </div>
      )}
    </div>
  );
}
