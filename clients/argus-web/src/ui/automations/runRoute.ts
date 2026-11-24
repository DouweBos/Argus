import type { RemoteAutomationRun } from "@argus/remote-protocol";
import { teammateThreadOrigin } from "@argus/client-core";
import type { Screen } from "../../routing/screens";

/** A run's own screen: under Quick Run for an ad-hoc one, its automation otherwise. */
export function runScreen(
  run: Pick<RemoteAutomationRun, "automation_id" | "id" | "is_quick">,
): Screen {
  return run.is_quick
    ? { name: "quickRunDetail", runId: run.id }
    : { name: "automationRun", automationId: run.automation_id, runId: run.id };
}

/** Where a proposal's run lives: a teammate conversation raises them from its thread. */
export function proposalRunScreen(proposal: {
  automation_id: string;
  run_id: string;
}): Screen {
  const teammate = teammateThreadOrigin(proposal.automation_id, proposal.run_id);

  return teammate
    ? {
        name: "teammate",
        teammateId: teammate.teammateId,
        page: "chat",
        threadId: teammate.threadId,
      }
    : {
        name: "automationRun",
        automationId: proposal.automation_id,
        runId: proposal.run_id,
      };
}

/** The automation a proposal came from, or the teammate whose conversation raised it. */
export function proposalSourceScreen(automationId: string): Screen {
  const teammate = teammateThreadOrigin(automationId, null);

  return teammate
    ? {
        name: "teammate",
        teammateId: teammate.teammateId,
        page: "chat",
        threadId: null,
      }
    : { name: "automation", automationId };
}
