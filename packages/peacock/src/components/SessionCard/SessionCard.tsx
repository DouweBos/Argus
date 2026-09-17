import type { BadgeTone } from "../Badge/Badge";
import type {
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import { Badge } from "../Badge/Badge";
import { BranchDivergence } from "../BranchDivergence/BranchDivergence";
import { DiffStat } from "../DiffStat/DiffStat";
import styles from "./SessionCard.module.css";

export interface SessionCardProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onSelect" | "title"
> {
  /** Leading icon node (caller picks RepoIcon/BranchIcon/PlayIcon/override). */
  icon?: ReactNode;
  /** Wrap the icon in the green pulsing span (agent / run-command running). */
  iconPulse?: boolean;
  iconTitle?: string;

  title: ReactNode;
  /** Small accent dot after the title (unread agent messages). */
  showUnread?: boolean;

  /** Kind pill ("root" / "worktree"); web only. */
  kind?: { label: string; tone: BadgeTone };
  /** Status pill; omit when the session is ready. */
  status?: { label: string; tone: BadgeTone; title?: string };
  /** Diff line counts, rendered via DiffStat. */
  diff?: { added?: number; removed?: number; files?: number };
  /** Compact ahead/behind/dirty indicator; web only. */
  divergence?: { ahead?: number; behind?: number; dirty?: number };

  /** Trailing actions (caller's ellipsis button + ContextMenu). */
  actions?: ReactNode;
  /**
   * "always": metrics + actions both visible (web/touch).
   * "hover": metrics visible at rest, faded on hover/focus to reveal the
   * absolutely-positioned actions (desktop sidebar).
   */
  actionReveal?: "always" | "hover";

  /** Second row below the title (branch + description / status). */
  subtitle?: ReactNode;

  selected?: boolean;
  /** Wires role/tabIndex/aria-selected/cursor + Enter-to-select. */
  interactive?: boolean;
  /** The event is passed so callers can treat a modifier-click differently. */
  onSelect?: (event?: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;

  /** Below-header content: progress, org pill, agent rows, forms, etc. */
  children?: ReactNode;
}

export function SessionCard({
  icon,
  iconPulse,
  iconTitle,
  title,
  showUnread,
  kind,
  status,
  diff,
  divergence,
  actions,
  actionReveal = "always",
  subtitle,
  selected,
  interactive,
  onSelect,
  onContextMenu,
  className,
  children,
  ...rest
}: SessionCardProps) {
  const classes = [
    styles.card,
    selected ? styles.selected : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const hasMetrics = Boolean(status || diff || divergence);

  const handleKeyDown = interactive
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter") {
          onSelect?.();
        }
      }
    : undefined;

  return (
    <div
      className={classes}
      data-reveal={actionReveal}
      aria-selected={interactive ? selected : undefined}
      role={interactive ? "option" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onSelect : undefined}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      <div className={styles.header}>
        {icon != null && (
          <span
            className={iconPulse ? styles.iconPulse : styles.icon}
            title={iconTitle}
          >
            {icon}
          </span>
        )}
        <span className={styles.title}>{title}</span>
        {showUnread && (
          <span
            className={styles.unreadDot}
            aria-label="Unread messages"
            title="Unread agent messages"
          />
        )}
        {kind && (
          <Badge tone={kind.tone} size="tag">
            {kind.label}
          </Badge>
        )}
        <div className={styles.trailing}>
          {hasMetrics && (
            <div className={styles.metrics}>
              {status && (
                <Badge tone={status.tone} title={status.title}>
                  {status.label}
                </Badge>
              )}
              {diff && (
                <DiffStat
                  added={diff.added}
                  removed={diff.removed}
                  files={diff.files}
                />
              )}
              {divergence && (
                <BranchDivergence
                  ahead={divergence.ahead}
                  behind={divergence.behind}
                  dirty={divergence.dirty}
                />
              )}
            </div>
          )}
          {actions && <span className={styles.actions}>{actions}</span>}
        </div>
      </div>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      {children}
    </div>
  );
}
