import type { HTMLAttributes, ReactNode } from "react";
import { LeftSidebarIcon, RightSidebarIcon } from "../../icons/Icons";
import { Kbd } from "../Kbd/Kbd";
import styles from "./TitleBar.module.css";

export interface TitleBarProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title?: ReactNode;
  /** Show traffic-light dots for non-hiddenInset title bars (defaults to true). */
  showTraffic?: boolean;
  /** Hotkey shown on the "Jump to anything" pill. */
  jumpHotkey?: string[];
  onJump?: () => void;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
  left?: ReactNode;
  right?: ReactNode;
}

export function TitleBar({
  title = "Argus",
  showTraffic = true,
  jumpHotkey = ["⌘", "⇧", "P"],
  onJump,
  onToggleLeft,
  onToggleRight,
  left,
  right,
  className,
  ...rest
}: TitleBarProps) {
  return (
    <div
      className={[styles.bar, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {showTraffic && (
        <div className={styles.traffic} aria-hidden>
          <span />
          <span />
          <span />
        </div>
      )}
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
      {left && <div className={styles.left}>{left}</div>}
      <div className={styles.title}>{title}</div>
      <div className={styles.right}>
        {right}
        <button className={styles.cmdk} onClick={onJump} type="button">
          <span className={styles.cmdkText}>Jump to anything</span>
          <Kbd keys={jumpHotkey} />
        </button>
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
