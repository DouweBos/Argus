import type { Crumb } from "@argus/peacock";
import { useMemo } from "react";
import { breadcrumbTrail } from "../../../lib/breadcrumbs";
import { useCurrentRoute } from "../../../lib/routeHooks";
import {
  openAutomation,
  openAutomationRun,
  openAutomations,
  openQuickRun,
  openQuickRuns,
  useAllRuns,
  useAutomations,
} from "../../../stores/automationStore";
import { useSessions } from "../../../stores/sessionStore";

const nav = {
  openAutomations: () => openAutomations(),
  openAutomation,
  openQuickRuns,
  openRun: (run: { automation_id: string; id: string; scratch: unknown }) =>
    run.scratch
      ? openQuickRun(run.id)
      : openAutomationRun(run.automation_id, run.id),
};

/** Feeds the title bar's trail from the route and the stores behind it. */
export function useBreadcrumbs(): Crumb[] {
  const { view, sessionId, automationId, automationQuick, automationRunId } =
    useCurrentRoute();
  const automations = useAutomations();
  const runs = useAllRuns();
  const sessions = useSessions();

  return useMemo(
    () =>
      breadcrumbTrail({
        view,
        sessionId,
        automationId,
        automationQuick,
        automationRunId,
        automations,
        runs,
        sessions,
        nav,
      }),
    [
      view,
      sessionId,
      automationId,
      automationQuick,
      automationRunId,
      automations,
      runs,
      sessions,
    ],
  );
}
