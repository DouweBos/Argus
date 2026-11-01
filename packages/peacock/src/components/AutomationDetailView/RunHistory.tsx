import {
  formatCost,
  formatRunDuration,
  formatTimestamp,
  isRunActive,
} from "@argus/client-core";
import type {
  RemoteAutomationRun,
  RemoteAutomationRunStatus,
} from "@argus/remote-protocol";
import type { ReactNode } from "react";
import { RunStatusBadge } from "../AutomationRunView/AutomationRunView";
import { RunHistoryRow } from "../RunHistoryRow/RunHistoryRow";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import styles from "./AutomationDetailView.module.css";

/** What a history row reads of a run — the catalog's and the gateway's share these. */
export interface RunHistoryEntry {
  id: string;
  status: RemoteAutomationRunStatus;
  started_at: number;
  finished_at: number | null;
  cost_usd: number | null;
  error: string | null;
  /** The name for a quick run, the trigger for a scheduled one. */
  label: string;
  unread: boolean;
}

/** The gateway's run, as a history row reads it. */
export function remoteRunEntry(
  run: RemoteAutomationRun,
  quick = false,
): RunHistoryEntry {
  return {
    id: run.id,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    cost_usd: run.cost_usd,
    error: run.error,
    label: quick ? run.automation_name : run.trigger_reason,
    unread: run.unread_report && !isRunActive(run),
  };
}

export interface RunHistoryProps {
  runs: RunHistoryEntry[];
  title?: string;
  empty: string;
  onOpen: (runId: string) => void;
  /** Cancel while it runs, delete once it has settled. */
  actions?: (run: RunHistoryEntry) => ReactNode;
}

/** Every time something ran, newest first. */
export function RunHistory({
  actions,
  empty,
  onOpen,
  runs,
  title = "Run history",
}: RunHistoryProps) {
  return (
    <SectionPanel
      meta={`${runs.length} run${runs.length === 1 ? "" : "s"}`}
      title={title}
    >
      {runs.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <div className={styles.runs}>
          {runs.map((run) => (
            <RunHistoryRow
              actions={actions?.(run)}
              cost={formatCost(run.cost_usd)}
              duration={formatRunDuration(run)}
              error={run.error ?? undefined}
              key={run.id}
              startedAt={formatTimestamp(run.started_at)}
              status={<RunStatusBadge status={run.status} />}
              triggerReason={run.label}
              unread={run.unread}
              onClick={() => onOpen(run.id)}
            />
          ))}
        </div>
      )}
    </SectionPanel>
  );
}
