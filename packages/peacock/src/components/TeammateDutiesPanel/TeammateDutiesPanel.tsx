import type { ReactNode } from "react";
import {
  AutomationRow,
  type AutomationRowProps,
} from "../AutomationRow/AutomationRow";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import styles from "./TeammateDutiesPanel.module.css";

export interface TeammateDutiesPanelProps {
  rows: (AutomationRowProps & { id: string })[];
  /** "Move an automation here", where this client may. */
  action?: ReactNode;
}

/** The automations a teammate runs; each opens on its own screen. */
export function TeammateDutiesPanel({
  action,
  rows,
}: TeammateDutiesPanelProps) {
  return (
    <SectionPanel action={action} meta={`${rows.length}`} title="Duties">
      {rows.length === 0 ? (
        <p className={styles.note}>
          No duties yet. Bring in an automation and it runs on its own trigger,
          as this teammate.
        </p>
      ) : (
        <div className={styles.list}>
          {rows.map(({ id, ...row }) => (
            <AutomationRow key={id} {...row} />
          ))}
        </div>
      )}
      <p className={styles.note}>
        A duty shares this teammate's memory and never goes further than its
        autonomy.
      </p>
    </SectionPanel>
  );
}
