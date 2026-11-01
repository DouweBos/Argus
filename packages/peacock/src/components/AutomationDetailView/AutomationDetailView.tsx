import type { ReactNode } from "react";
import { ClockIcon } from "../../icons/Icons";
import { Banner } from "../Banner/Banner";
import { EmptyState } from "../EmptyState/EmptyState";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { Spinner } from "../Spinner/Spinner";
import styles from "./AutomationDetailView.module.css";

export interface AutomationDetailViewProps {
  /** Null while loading, or once it turns out to be gone. */
  name: string | null;
  loading?: boolean;
  /** "09:00 weekdays · next Nov 3, 09:00 (in 18h)". */
  meta?: string;
  /** Enabled switch, run or cancel, delete. */
  actions?: ReactNode;
  error?: string | null;
  /** The track record, when there is one. */
  trackRecord?: ReactNode;
  /** The editor: usually `AutomationFields`. */
  configuration: ReactNode;
  /** The save button, in the configuration panel's header. */
  saveAction?: ReactNode;
  memories?: ReactNode;
  /** Usually a `RunHistory`. */
  runs: ReactNode;
  /** The way back from a missing automation. */
  missingAction?: ReactNode;
}

/** One automation: what it does, what it remembers, and every time it ran. */
export function AutomationDetailView({
  actions,
  configuration,
  error,
  loading,
  memories,
  meta,
  missingAction,
  name,
  runs,
  saveAction,
  trackRecord,
}: AutomationDetailViewProps) {
  if (name === null) {
    return loading ? (
      <div className={styles.loading}>
        <Spinner />
      </div>
    ) : (
      <EmptyState
        action={missingAction}
        body="It may have been deleted on the computer this is reading from."
        icon={<ClockIcon size={18} />}
        title="Automation not found"
      />
    );
  }

  return (
    <div className={styles.view}>
      {actions && <header className={styles.head}>{actions}</header>}
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>{name}</h1>
        {meta && <p className={styles.meta}>{meta}</p>}
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {trackRecord}
      <SectionPanel action={saveAction} title="Configuration">
        {configuration}
      </SectionPanel>
      {memories}
      {runs}
    </div>
  );
}
