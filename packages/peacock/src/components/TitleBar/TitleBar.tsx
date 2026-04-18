import type { HTMLAttributes, ReactNode } from "react";
import styles from "./TitleBar.module.css";
import { Kbd } from "../Kbd/Kbd";
import { LeftSidebarIcon, RightSidebarIcon } from "../../icons/Icons";

export interface TitleBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  /** Show traffic-light dots for non-hiddenInset title bars (defaults to true). */
  showTraffic?: boolean;
  onJump?: () => void;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
  right?: ReactNode;
}

export function TitleBar({
  title = "Argus",
  showTraffic = true,
  onJump,
  onToggleLeft,
  onToggleRight,
  right,
  className,
  ...rest
}: TitleBarProps) {
  return (
    <div className={[styles.bar, className].filter(Boolean).join(" ")} {...rest}>
      {showTraffic && (
        <div className={styles.traffic} aria-hidden>
          <span style={{ background: "#ff5f57" }} />
          <span style={{ background: "#febc2e" }} />
          <span style={{ background: "#28c840" }} />
        </div>
      )}
      <div className={styles.title}>{title}</div>
      <div className={styles.right}>
        {right}
        <button className={styles.cmdk} onClick={onJump} type="button">
          <SearchGlyph />
          <span className={styles.cmdkText}>Jump to anything</span>
          <Kbd keys={["⌘", "K"]} />
        </button>
        {onToggleLeft && (
          <button
            className={styles.iconBtn}
            onClick={onToggleLeft}
            aria-label="Toggle left sidebar"
            type="button"
          >
            <LeftSidebarIcon size={14} />
          </button>
        )}
        {onToggleRight && (
          <button
            className={styles.iconBtn}
            onClick={onToggleRight}
            aria-label="Toggle right sidebar"
            type="button"
          >
            <RightSidebarIcon size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" />
    </svg>
  );
}
