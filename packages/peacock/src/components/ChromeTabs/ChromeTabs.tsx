import type { ReactNode } from "react";
import styles from "./ChromeTabs.module.css";

export interface ChromeTab<ID extends string> {
  id: ID;
  title: string;
  icon?: ReactNode;
  /** A count after the title ("Changes 3"); hidden at 0. */
  count?: number;
}

export interface ChromeTabsProps<ID extends string> {
  tabs: ChromeTab<ID>[];
  selectedId: ID | null;
  onSelect: (id: ID) => void;
  "aria-label"?: string;
}

/**
 * The Mac chrome's text tabs: icon and title, the one in front on a quiet
 * fill. The git panel's views, the side panel's tabs.
 */
export function ChromeTabs<ID extends string>({
  tabs,
  selectedId,
  onSelect,
  "aria-label": ariaLabel,
}: ChromeTabsProps<ID>) {
  return (
    <div aria-label={ariaLabel} className={styles.tabs} role="tablist">
      {tabs.map((tab) => {
        const on = tab.id === selectedId;

        return (
          <button
            key={tab.id}
            aria-selected={on}
            className={styles.tab}
            data-selected={on || undefined}
            role="tab"
            title={tab.title}
            type="button"
            onClick={() => onSelect(tab.id)}
          >
            {tab.icon}
            <span className={styles.title}>{tab.title}</span>
            {tab.count != null && tab.count > 0 && (
              <span className={styles.count}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
