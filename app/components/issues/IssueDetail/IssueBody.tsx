import type { LinearIssueDetail } from "../../../lib/types";
import { Icons, IssueStatusIcon, Markdown } from "@argus/peacock";
import { figmaLinkHandler, isFigmaUrl } from "../../../lib/designViewer";
import { openExternalUrl } from "../../../lib/ipc";
import { ago } from "../../../lib/issueActivity";
import { appNavigate } from "../../../lib/router";
import styles from "./IssueDetail.module.css";

const openFigmaLink = figmaLinkHandler("issue");

const RELATION_TITLES: Record<string, string> = {
  blocks: "Blocks",
  blocked_by: "Blocked by",
  duplicate: "Duplicated by",
  duplicate_of: "Duplicate of",
  related: "Related",
  similar: "Similar",
};

function openIssue(identifier: string) {
  appNavigate({ view: "issues", issueRef: identifier });
}

function IssueLink({
  identifier,
  title,
  type,
}: {
  identifier: string;
  title: string;
  type: string;
}) {
  return (
    <button
      className={styles.issueRow}
      type="button"
      onClick={() => openIssue(identifier)}
    >
      <IssueStatusIcon type={type} />
      <span className={styles.mono}>{identifier}</span>
      <span className={styles.rowTitle}>{title}</span>
    </button>
  );
}

/** Title, description, sub-issues, relations and linked resources. */
export function IssueBody({ issue }: { issue: LinearIssueDetail }) {
  const relations = issue.relations ?? [];
  const relationGroups = [...new Set(relations.map((r) => r.type))];

  return (
    <>
      {issue.parent && (
        <button
          className={styles.parent}
          type="button"
          onClick={() => issue.parent && openIssue(issue.parent.identifier)}
        >
          {issue.parent.identifier} › {issue.parent.title}
        </button>
      )}
      <h1 className={styles.title}>{issue.title}</h1>
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
          <h3 className={styles.sectionTitle}>
            Sub-issues{" "}
            <span className={styles.muted}>{issue.children.length}</span>
          </h3>
          {issue.children.map((child) => (
            <IssueLink
              key={child.identifier}
              identifier={child.identifier}
              title={child.title}
              type={child.state.type}
            />
          ))}
        </section>
      )}

      {relationGroups.map((type) => (
        <section key={type} className={styles.section}>
          <h3 className={styles.sectionTitle}>
            {RELATION_TITLES[type] ?? type}
          </h3>
          {relations
            .filter((r) => r.type === type)
            .map((r) => (
              <IssueLink
                key={r.identifier}
                identifier={r.identifier}
                title={r.title}
                type={r.state.type}
              />
            ))}
        </section>
      ))}

      {issue.attachments.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Resources</h3>
          {issue.attachments.map((a) => (
            <button
              key={a.url}
              className={styles.resource}
              type="button"
              onClick={() => {
                if (!openFigmaLink(a.url)) {
                  openExternalUrl(a.url).catch(() => {});
                }
              }}
            >
              {isFigmaUrl(a.url) ? (
                <Icons.FigmaIcon size={12} />
              ) : (
                <Icons.LinkIcon size={12} />
              )}
              <span className={styles.rowTitle}>{a.title}</span>
              {a.subtitle && <span className={styles.mono}>{a.subtitle}</span>}
              {a.createdAt && (
                <span className={styles.resourceTime}>{ago(a.createdAt)}</span>
              )}
            </button>
          ))}
        </section>
      )}
    </>
  );
}
