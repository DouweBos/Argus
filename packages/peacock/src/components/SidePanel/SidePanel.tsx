import type { ReactNode } from "react";
import { CloseIcon } from "../../icons/Icons";
import { ChromeTabs, type ChromeTab } from "../ChromeTabs/ChromeTabs";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import styles from "./SidePanel.module.css";

export type SidePanelTab<ID extends string> = ChromeTab<ID>;

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
        <ChromeTabs<ID>
          aria-label="Side panel"
          selectedId={selectedId}
          tabs={tabs}
          onSelect={onSelect}
        />
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
