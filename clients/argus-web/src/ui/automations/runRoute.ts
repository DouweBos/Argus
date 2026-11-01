import type { RemoteAutomationRun } from "@argus/remote-protocol";
import type { Screen } from "../../routing/screens";

/** A run's own screen: under Quick Run for an ad-hoc one, its automation otherwise. */
export function runScreen(
  run: Pick<RemoteAutomationRun, "automation_id" | "id" | "is_quick">,
): Screen {
  return run.is_quick
    ? { name: "quickRunDetail", runId: run.id }
    : { name: "automationRun", automationId: run.automation_id, runId: run.id };
}
