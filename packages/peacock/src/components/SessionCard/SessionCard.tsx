import type { BadgeTone } from "../Badge/Badge";
import type {
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import { DriveIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { BranchDivergence } from "../BranchDivergence/BranchDivergence";
import { DiffStat } from "../DiffStat/DiffStat";
import {
  PullRequestState,
  type PullRequestStateKind,
} from "../PullRequestState/PullRequestState";
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
  /** Name of the external drive the session lives on; shows a drive icon. */
  drive?: string;
  /** The branch's pull request, drawn as GitHub's icon in its state colour. */
  pullRequest?: {
    number: number;
    state: PullRequestStateKind;
    onOpen?: () => void;
  };

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
  /**
   * Draw the card as a bordered surface with roomier padding. For touch
   * layouts, where the desktop's hover-revealed flat row reads as nothing.
   */
  framed?: boolean;
  /** Wires role/tabIndex/aria-selected/cursor + Enter-to-select. */
  interactive?: boolean;
  /**
   * The session's files are out of reach (its drive is disconnected). The row
   * keeps its last known content but is dimmed and cannot be selected.
   *
   * Composes with `selected` — the URL may still point here — and deliberately
   * keeps `role="option"` and the context menu, because the tooltip and the
   * menu are what explain the state.
   */
  unavailable?: boolean;
  /** Tooltip naming the drive, e.g. "Blackbox isn't connected". */
  unavailableTitle?: string;
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
  drive,
  pullRequest,
  kind,
  status,
  diff,
  divergence,
  actions,
  actionReveal = "always",
  subtitle,
  selected,
  framed,
  interactive,
  unavailable,
  unavailableTitle,
  onSelect,
  onContextMenu,
  className,
  children,
  ...rest
}: SessionCardProps) {
  const classes = [
    styles.card,
    framed ? styles.framed : "",
    selected ? styles.selected : "",
    unavailable ? styles.unavailable : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const hasMetrics = Boolean(status || diff || divergence);

  const selectable = interactive && !unavailable;
  let tabIndex: number | undefined;
  if (interactive) {
    tabIndex = unavailable ? -1 : 0;
  }

  const handleKeyDown = selectable
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
      aria-disabled={unavailable || undefined}
      role={interactive ? "option" : undefined}
      // Still reachable programmatically, but out of the tab order: tabbing
      // onto a row you cannot open is a dead end.
      tabIndex={tabIndex}
      title={unavailable ? unavailableTitle : undefined}
      onClick={selectable ? onSelect : undefined}
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
        {pullRequest && (
          <PullRequestState
            number={pullRequest.number}
            state={pullRequest.state}
            onOpen={pullRequest.onOpen}
            size={11}
          />
        )}
        {drive && (
          <span
            className={styles.drive}
            aria-label={`On ${drive}`}
            title={`On ${drive}`}
          >
            <DriveIcon size={11} />
          </span>
        )}
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
