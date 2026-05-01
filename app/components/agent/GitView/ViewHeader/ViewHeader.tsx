import type { ReactNode } from "react";
import { Icons } from "@argus/peacock";
import styles from "./ViewHeader.module.css";

export interface ViewHeaderProps {
  /** Leading icon. Defaults to a branch glyph. */
  leading?: ReactNode;
  /** Click handler for the subtitle/dropdown. */
  onSubtitleClick?: () => void;
  /** Click handler for the title (turns the title into a button). */
  onTitleClick?: () => void;
  /** Optional muted suffix (e.g. "No Track…", upstream name). */
  subtitle?: string;
  /** Primary label — e.g. branch name, "All Branches, Remotes, Tags". */
  title: string;
  /** Right-aligned slot for status badges or chips. */
  trailing?: ReactNode;
}

/**
 * Compact (~28px) inline header used at the top of every Git sub-view's
 * content column. Mirrors the design's `centerCol > branch row` element and
 * replaces the full-width GitStatusStrip that previously sat above all views.
 */
export function ViewHeader({
  leading,
  title,
  subtitle,
  onTitleClick,
  onSubtitleClick,
  trailing,
}: ViewHeaderProps) {
  const titleNode = (
    <span className={styles.title} title={title}>
      {title}
    </span>
  );

  return (
    <div className={styles.header}>
      <span className={styles.leading}>
        {leading ?? <Icons.BranchIcon size={12} />}
      </span>
      {onTitleClick ? (
        <button
          type="button"
          className={styles.titleButton}
          onClick={onTitleClick}
        >
          {titleNode}
        </button>
      ) : (
        titleNode
      )}
      <span className={styles.spacer} />
      {trailing && <span className={styles.trailing}>{trailing}</span>}
      {(subtitle || onSubtitleClick) && (
        <button
          type="button"
          className={styles.subtitleButton}
          onClick={onSubtitleClick}
          disabled={!onSubtitleClick}
        >
          <span className={styles.subtitle}>{subtitle}</span>
          <Icons.ChevronDownIcon size={10} />
        </button>
      )}
    </div>
  );
}
