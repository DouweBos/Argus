import type { ReactNode } from "react";
import { CloseIcon } from "../../icons/Icons";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import styles from "./SidePanel.module.css";

export interface SidePanelTab<ID extends string> {
  id: ID;
  title: string;
  icon: ReactNode;
}

export interface SidePanelProps<ID extends string> {
  tabs: SidePanelTab<ID>[];
  selectedId: ID | null;
  onSelect: (id: ID) => void;
  /** Hide the panel; shown as a close button at the strip's end. */
  onClose?: () => void;
  children: ReactNode;
}

/** The window's right-hand panel: a tab strip over the tab in front. */
export function SidePanel<ID extends string>({
  tabs,
  selectedId,
  onSelect,
  onClose,
  children,
}: SidePanelProps<ID>) {
  return (
    <div className={styles.panel}>
      <div className={styles.strip}>
        <div className={styles.tabs} role="tablist">
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
                <span className={styles.tabTitle}>{tab.title}</span>
              </button>
            );
          })}
        </div>
        {onClose && (
          <FlatIconButton
            icon={<CloseIcon size={11} />}
            label="Hide side panel"
            size="sm"
            onClick={onClose}
          />
        )}
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
