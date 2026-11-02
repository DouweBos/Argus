import type { LinearIssueDetail } from "@argus/remote-protocol";
import { FigmaIcon, LinkIcon } from "../../icons/Icons";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { Markdown, type MarkdownProps } from "../Markdown/Markdown";
import styles from "./IssueDetail.module.css";

const RELATION_TITLES: Record<string, string> = {
  blocks: "Blocks",
  blocked_by: "Blocked by",
  duplicate: "Duplicated by",
  duplicate_of: "Duplicate of",
  related: "Related",
  similar: "Similar",
};

/** How the issue's text renders links and uploads, shared with its comments. */
export interface IssueTextProps {
  /** A link in the text was clicked; true when it was handled. */
  onLinkClick?: MarkdownProps["onLinkClick"];
  /** Inline players and images for uploads; null leaves a link. */
  renderEmbed?: MarkdownProps["renderEmbed"];
}

export interface IssueBodyProps extends IssueTextProps {
  /** "5w ago". */
  ago: (epochMs: number) => string;
  /** Resources that open in the design viewer get its glyph. */
  isDesignUrl?: (url: string) => boolean;
  issue: LinearIssueDetail;
  onOpenIssue: (identifier: string) => void;
  onOpenResource: (url: string) => void;
}

function IssueLink({
  identifier,
  onOpen,
  title,
  type,
}: {
  identifier: string;
  onOpen: (identifier: string) => void;
  title: string;
  type: string;
}) {
  return (
    <button
      className={styles.issueRow}
      type="button"
      onClick={() => onOpen(identifier)}
    >
      <IssueStatusIcon type={type} />
      <span className={styles.mono}>{identifier}</span>
      <span className={styles.rowTitle}>{title}</span>
    </button>
  );
}

/** Title, description, sub-issues, relations and linked resources. */
export function IssueBody({
  ago,
  isDesignUrl,
  issue,
  onLinkClick,
  onOpenIssue,
  onOpenResource,
  renderEmbed,
}: IssueBodyProps) {
  const relations = issue.relations ?? [];
  const relationGroups = [...new Set(relations.map((r) => r.type))];
  const parent = issue.parent;

  return (
    <>
      {parent && (
        <button
          className={styles.parent}
          type="button"
          onClick={() => onOpenIssue(parent.identifier)}
        >
          {parent.identifier} › {parent.title}
        </button>
      )}
      <h1 className={styles.title}>{issue.title}</h1>
      {issue.description.trim() ? (
        <Markdown
          className={styles.description}
          renderEmbed={renderEmbed}
          text={issue.description}
          onLinkClick={onLinkClick}
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
              onOpen={onOpenIssue}
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
                onOpen={onOpenIssue}
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
              onClick={() => onOpenResource(a.url)}
            >
              {isDesignUrl?.(a.url) ? (
                <FigmaIcon size={12} />
              ) : (
                <LinkIcon size={12} />
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
