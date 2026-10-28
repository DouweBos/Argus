import { useEffect, useId, useState } from "react";
import {
  Dialog,
  DialogBody,
  EmptyState,
  Icons,
  IssueStatusIcon,
  Markdown,
  Spinner,
} from "@argus/peacock";
import { figmaLinkHandler, isFigmaUrl } from "../../../lib/designViewer";
import { openExternalUrl } from "../../../lib/ipc";
import {
  loadLinearIssueDetail,
  useLinearIssueDetail,
} from "../../../stores/linearIssuesStore";
import { IssueComments } from "./IssueComments";
import styles from "./IssueDetail.module.css";
import { IssueProperties } from "./IssueProperties";

const openFigmaLink = figmaLinkHandler("issue");

interface IssueDetailDialogProps {
  issueRef: string;
  onClose: () => void;
  /** Null when there's no project to start an agent in. */
  onStart: ((identifier: string) => void) | null;
}

/** The whole ticket: description, sub-issues, links and comments, plus its properties. */
export function IssueDetailDialog({
  issueRef,
  onClose,
  onStart,
}: IssueDetailDialogProps) {
  const titleId = useId();
  const issue = useLinearIssueDetail(issueRef);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLinearIssueDetail(issueRef).then(
      (found) => {
        if (!cancelled && !found) {
          setError(`Linear has no issue ${issueRef}.`);
        }
      },
      (err: unknown) => !cancelled && setError(String(err)),
    );

    return () => {
      cancelled = true;
    };
  }, [issueRef]);

  return (
    <Dialog
      size="full"
      title={issue ? `${issue.identifier}  ${issue.title}` : issueRef}
      titleId={titleId}
      onClose={onClose}
    >
      <DialogBody>
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
            <div className={styles.main}>
              {issue.parent && (
                <p className={styles.parent}>
                  Sub-issue of {issue.parent.identifier} · {issue.parent.title}
                </p>
              )}
              {issue.description.trim() ? (
                <Markdown
                  className={styles.description}
                  text={issue.description}
                  onLinkClick={openFigmaLink}
                />
              ) : (
                <p className={styles.muted}>No description.</p>
              )}

              {issue.children.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>Sub-issues</h3>
                  {issue.children.map((child) => (
                    <div key={child.identifier} className={styles.childRow}>
                      <IssueStatusIcon type={child.state.type} />
                      <span className={styles.mono}>{child.identifier}</span>
                      <span>{child.title}</span>
                    </div>
                  ))}
                </section>
              )}

              {issue.attachments.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>Links</h3>
                  {issue.attachments.map((a) => (
                    <button
                      key={a.url}
                      className={styles.link}
                      type="button"
                      onClick={() => {
                        if (!openFigmaLink(a.url)) {
                          openExternalUrl(a.url).catch(() => {});
                        }
                      }}
                    >
                      {isFigmaUrl(a.url) ? (
                        <Icons.FigmaIcon size={11} />
                      ) : (
                        <Icons.ArrowUpRightIcon size={11} />
                      )}
                      <span>{a.title}</span>
                      {a.subtitle && (
                        <span className={styles.muted}>{a.subtitle}</span>
                      )}
                    </button>
                  ))}
                </section>
              )}

              <IssueComments issue={issue} />
            </div>
            <IssueProperties issue={issue} onStart={onStart} />
          </div>
        )}
      </DialogBody>
    </Dialog>
  );
}
