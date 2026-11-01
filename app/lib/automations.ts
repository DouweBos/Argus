/**
 * Presentation helpers for automations. The shared half — labels, tones,
 * times and the cron preview — is `@argus/client-core`'s, so the desktop and
 * the web client read the same; this adds the catalog-shaped wrappers.
 */

import type { Automation, AutomationRun, AutomationTrigger } from "./types";
import {
  nextRunLabel as nextRunLabelFor,
  reportPreview as reportPreviewLine,
} from "@argus/client-core";

export {
  AUTONOMY_CAPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
  cronError,
  DEFAULT_GUARDRAILS,
  formatCost,
  formatRelative,
  formatRunDuration as formatDuration,
  formatTimestamp,
  isRunActive,
  isValidCron,
  localTimezone,
  nextFireTimes,
  runStatusTone,
} from "@argus/client-core";

/** One-line description of a trigger, for list rows. */
export function triggerLabel(trigger: AutomationTrigger): string {
  return trigger.kind === "schedule"
    ? `${trigger.cron} · ${trigger.timezone}`
    : "Manual only";
}

/** A finished run whose report nobody has looked at, and nothing has replaced. */
export function isUnreadReport(run: AutomationRun): boolean {
  if (run.report_read || run.status === "queued" || run.status === "running") {
    return false;
  }

  return (
    (run.report_blocks?.length ?? 0) > 0 || (run.report_markdown ?? "") !== ""
  );
}

/** One line of what a report says, for a list row that links to the full one. */
export function reportPreview(run: AutomationRun): string {
  return reportPreviewLine(run) ?? "Report ready to read.";
}

/** What the list shows under "next run". */
export function nextRunLabel(automation: Automation): string {
  return nextRunLabelFor({
    enabled: automation.enabled,
    next_run_at: automation.next_run_at,
    trigger_kind: automation.trigger.kind,
  });
}
