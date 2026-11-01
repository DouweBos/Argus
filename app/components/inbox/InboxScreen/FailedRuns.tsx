import type { AutomationRun } from "../../../lib/types";
import { InboxRunList } from "@argus/peacock";
import { useFailedRunItems } from "./inboxRows";

/** Runs that did not finish — the automation itself needs attention. */
export function FailedRuns({ runs }: { runs: AutomationRun[] }) {
  return (
    <InboxRunList
      dismissLabel="Dismiss"
      items={useFailedRunItems(runs)}
      tone="alert"
    />
  );
}
