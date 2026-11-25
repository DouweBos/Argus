import type { Teammate } from "./models";
import type { TeammateThread } from "./threads";
import { hasUnreadReport, listAutomationRuns } from "../automation/manager";
import { dutiesOf, listTeammates } from "./manager";
import { listThreads } from "./threads";

export interface TeammateSummary {
  teammate: Teammate;
  duty_count: number;
  last_run_at: number | null;
  has_unread_report: boolean;
  /** The conversation touched last, for the list's preview line. */
  latest_thread?: TeammateThread | null;
  /** A duty run is queued or in flight. */
  working?: boolean;
}

export function teammateSummaries(): TeammateSummary[] {
  return listTeammates().map((teammate) => {
    const dutyIds = new Set(dutiesOf(teammate.id).map((d) => d.id));
    const runs = listAutomationRuns().filter((r) =>
      dutyIds.has(r.automation_id),
    );

    return {
      teammate,
      duty_count: dutyIds.size,
      last_run_at: runs.reduce<number | null>(
        (newest, r) =>
          newest === null || r.started_at > newest ? r.started_at : newest,
        null,
      ),
      has_unread_report: runs.some(hasUnreadReport),
      latest_thread: listThreads(teammate.id)[0] ?? null,
      working: runs.some(
        (r) => r.status === "running" || r.status === "queued",
      ),
    };
  });
}
