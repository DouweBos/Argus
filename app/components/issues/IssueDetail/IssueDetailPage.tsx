import { useEffect, useState } from "react";
import { Button, EmptyState, Icons, Spinner } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import {
  loadLinearIssueDetail,
  useLinearIssueDetail,
} from "../../../stores/linearIssuesStore";
import { IssueActivitySection } from "./IssueActivitySection";
import { IssueBody } from "./IssueBody";
import styles from "./IssueDetail.module.css";
import { IssueProperties } from "./IssueProperties";

function copyText(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {});
}

interface IssueDetailPageProps {
  issueRef: string;
  /** "My issues" — the list it was opened from, for the breadcrumb. */
  listTitle: string;
  onClose: () => void;
  onOpen: (identifier: string) => void;
  /** Null when there's no project to start an agent in. */
  onStart: ((identifier: string) => void) | null;
  /** The list's order, for previous/next. */
  order: string[];
}

/** The whole ticket as a page, the way Linear shows it. */
export function IssueDetailPage({
  issueRef,
  listTitle,
  onClose,
  onOpen,
  onStart,
  order,
}: IssueDetailPageProps) {
  const issue = useLinearIssueDetail(issueRef);
  // Keyed by issue, so moving to the next one drops the last one's error.
  const [failure, setFailure] = useState<{
    message: string;
    ref: string;
  } | null>(null);
  const error = failure?.ref === issueRef ? failure.message : null;
  const index = order.indexOf(issueRef);

  useEffect(() => {
    let cancelled = false;
    loadLinearIssueDetail(issueRef).then(
      (found) => {
        if (!cancelled && !found) {
          setFailure({
            ref: issueRef,
            message: `Linear has no issue ${issueRef}.`,
          });
        }
      },
      (err: unknown) =>
        !cancelled && setFailure({ ref: issueRef, message: String(err) }),
    );

    return () => {
      cancelled = true;
    };
  }, [issueRef]);

  // j/k walk the list like Linear's arrows; Escape goes back to it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) {
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
        <Icons.ChevronRightIcon size={8} />
        <span className={styles.crumbCurrent}>
          <span className={styles.mono}>{issueRef}</span>
          {issue && <span className={styles.rowTitle}>{issue.title}</span>}
        </span>
        <span className={styles.topBarSpacer} />
        {issue && (
          <>
            <Button
              variant="ghost"
              size="sm"
              title="Copy link"
              aria-label="Copy link"
              onClick={() => copyText(issue.url)}
            >
              <Icons.LinkIcon size={12} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Copy ID"
              aria-label="Copy ID"
              onClick={() => copyText(issue.identifier)}
            >
              <Icons.CopyIcon size={12} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Copy branch name"
              aria-label="Copy branch name"
              onClick={() => copyText(issue.branchName)}
            >
              <Icons.BranchIcon size={12} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Open in Linear"
              aria-label="Open in Linear"
              onClick={() => openExternalUrl(issue.url).catch(() => {})}
            >
              <Icons.ArrowUpRightIcon size={12} />
            </Button>
          </>
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
              <Icons.ChevronDownIcon size={10} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Previous issue (k)"
              aria-label="Previous issue"
              disabled={index <= 0}
              onClick={() => onOpen(order[index - 1])}
            >
              <Icons.ChevronUpIcon size={10} />
            </Button>
          </span>
        )}
      </div>

      {!issue && error && (
        <EmptyState
          icon={<Icons.WarningIcon size={20} />}
          title="Couldn't load the issue"
          body={error}
        />
      )}
      {!issue && !error && (
        <EmptyState icon={<Spinner size="md" />} title="Loading issue" />
      )}
      {issue && (
        <div className={styles.layout}>
          <main className={styles.main}>
            <IssueBody issue={issue} />
            <IssueActivitySection issue={issue} />
          </main>
          <IssueProperties issue={issue} onStart={onStart} />
        </div>
      )}
    </div>
  );
}
