import type { ReactNode } from "react";
import chrome from "./RuntimeChrome.module.css";

interface RuntimeTitleBarProps {
  /** Content rendered inside the floating action bar below the title row. */
  actionBar?: ReactNode;
  /** Slot rendered at the start of the title row (e.g. platform toggle). */
  children?: ReactNode;
  /** Picker element (e.g. device or browser preset `<select>`). */
  picker?: ReactNode;
  /** Whether to show the floating action bar. Defaults to `false`. */
  showActionBar?: boolean;
  /** Use `justify-content: space-between` on the floating bar (native sim style). */
  spacedActionBar?: boolean;
  /** Toggles pinned to the far right of the title row (e.g. expand, popout). */
  toggles?: ReactNode;
  /** Trailing controls on the title row (e.g. boot button). */
  trailing?: ReactNode;
}

export function RuntimeTitleBar({
  children,
  picker,
  trailing,
  toggles,
  actionBar,
  showActionBar = false,
  spacedActionBar = false,
}: RuntimeTitleBarProps) {
  return (
    <>
      <div className={chrome.titleBar}>
        {children}
        {picker}
        {trailing}
        {toggles && <div className={chrome.titleBarToggles}>{toggles}</div>}
      </div>
      {showActionBar && actionBar && (
        <div
          className={
            spacedActionBar
              ? `${chrome.floatingBar} ${chrome.floatingBarSpaced}`
              : chrome.floatingBar
          }
        >
          {actionBar}
        </div>
      )}
    </>
  );
}
