import type { ReactNode } from "react";
import { CloseIcon, PlusIcon } from "../../icons/Icons";
import { StatusDot, type StatusTone } from "../Badge/Badge";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import styles from "./AgentTabStrip.module.css";

export interface AgentTab {
  id: string;
  title: string;
  status: StatusTone;
  /** Working right now: the dot pulses. */
  busy?: boolean;
}

export interface AgentTabStripProps {
  tabs: AgentTab[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Close a tab; omitted, tabs have no close button. */
  onClose?: (id: string) => void;
  /** The `+` at the end; omitted (or `canStart` false), no new agent. */
  onNew?: () => void;
  canStart?: boolean;
  /** Room kept clear at the end, e.g. for the session's context card. */
  trailing?: ReactNode;
}

/** A session's agents as tabs, as on the Mac: a status dot, a title, a close button. */
export function AgentTabStrip({
  tabs,
  selectedId,
  onSelect,
  onClose,
  onNew,
  canStart = true,
  trailing,
}: AgentTabStripProps) {
  return (
    <div className={styles.strip}>
      <div className={styles.tabs} role="tablist">
        {tabs.map((tab) => {
          const selected = tab.id === selectedId;

          return (
            <div
              key={tab.id}
              className={styles.tab}
              data-selected={selected || undefined}
            >
              <button
                aria-selected={selected}
                className={styles.tabButton}
                role="tab"
                title={tab.title}
                type="button"
                onClick={() => onSelect(tab.id)}
              >
                <StatusDot pulse={tab.busy} tone={tab.status} />
                <span className={styles.title}>{tab.title}</span>
              </button>
              {onClose && (
                <button
                  aria-label={`Close ${tab.title}`}
                  className={styles.close}
                  title="Close"
                  type="button"
                  onClick={() => onClose(tab.id)}
                >
                  <CloseIcon size={9} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {onNew && (
        <FlatIconButton
          disabled={!canStart}
          icon={<PlusIcon size={13} />}
          label="New agent"
          onClick={onNew}
        />
      )}
      {trailing}
    </div>
  );
}
