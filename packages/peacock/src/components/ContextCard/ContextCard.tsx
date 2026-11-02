import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "../../icons/Icons";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import styles from "./ContextCard.module.css";

export interface ContextCardProps {
  /** Folded down to its switcher: the same metrics, no card around it. */
  collapsed?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A small floating card of facts and actions about what's on screen, as the
 * Mac pins at a session's top right.
 */
export function ContextCard({
  collapsed,
  children,
  className,
}: ContextCardProps) {
  return (
    <div
      className={[styles.card, className].filter(Boolean).join(" ")}
      data-collapsed={collapsed || undefined}
    >
      {children}
    </div>
  );
}

export interface ContextCardSegment<ID extends string> {
  id: ID;
  title: string;
  icon: ReactNode;
  /** Tooltip; defaults to the title. */
  help?: string;
}

export interface ContextCardSegmentsProps<ID extends string> {
  segments: ContextCardSegment<ID>[];
  selected: ID | null;
  onSelect: (id: ID) => void;
  /** With a toggle, the chevron that folds the card down to these. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

/** The card's view switcher (Agent / Code / Git) and its fold chevron. */
export function ContextCardSegments<ID extends string>({
  segments,
  selected,
  onSelect,
  collapsed,
  onToggleCollapsed,
}: ContextCardSegmentsProps<ID>) {
  return (
    <div className={styles.segments} role="tablist">
      {segments.map((segment) => {
        const on = segment.id === selected;

        return (
          <button
            key={segment.id}
            aria-selected={on}
            className={styles.segment}
            data-selected={on || undefined}
            role="tab"
            title={segment.help ?? segment.title}
            type="button"
            onClick={() => onSelect(segment.id)}
          >
            {segment.icon}
            <span>{segment.title}</span>
          </button>
        );
      })}
      {onToggleCollapsed && (
        <FlatIconButton
          icon={
            collapsed ? (
              <ChevronDownIcon size={11} />
            ) : (
              <ChevronUpIcon size={11} />
            )
          }
          label={collapsed ? "Show session details" : "Hide session details"}
          size="sm"
          onClick={onToggleCollapsed}
        />
      )}
    </div>
  );
}

export interface ContextCardRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  /** Nothing to act on right now (no commits to push): secondary text. */
  muted?: boolean;
  /** A count, change totals or a status dot on the far side. */
  trailing?: ReactNode;
}

/** One fact or action in the card: icon, title, and what's on the far side. */
export function ContextCardRow({
  icon,
  label,
  muted,
  trailing,
  className,
  title,
  type = "button",
  ...rest
}: ContextCardRowProps) {
  return (
    <button
      className={[styles.row, className].filter(Boolean).join(" ")}
      data-muted={muted || undefined}
      title={title ?? label}
      type={type}
      {...rest}
    >
      <span className={styles.icon}>{icon}</span>
      <span className={styles.title}>{label}</span>
      {trailing != null && <span className={styles.trailing}>{trailing}</span>}
    </button>
  );
}

/** A hairline between the card's groups of rows. */
export function ContextCardDivider() {
  return <div className={styles.divider} role="separator" />;
}
