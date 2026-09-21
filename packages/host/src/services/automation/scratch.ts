/**
 * Ad-hoc runs — a playbook run once, against some repos, with nothing saved.
 *
 * Before this, the only way to run something was to create an automation and
 * press Run, which left a record you may not have wanted. An ad-hoc run is the
 * same thing minus the record: the same host session, the same agent, the same
 * runner, the same ladder.
 *
 * It is modelled as a *synthetic automation*: the run carries a
 * {@link ScratchSpec} and `getAutomation` rebuilds an `Automation` from it on
 * demand (`manager.ts`). Nothing else in the feature has to know ad-hoc runs
 * exist — `resolvePolicy`, `evaluateAutoStart`, the shell guard, the MCP guards
 * and the spend ceilings all read the shape they already read. The alternative,
 * a null `automation_id`, would have made that id nullable in the proposals,
 * the owned-session claims, the outcomes and every guard that resolves through
 * them, and each of those nullable branches would have been a hole to audit.
 *
 * The spec never reaches `automations.json`; it lives on the run record, and
 * goes when the run is swept.
 */

import type { Automation, AutomationRun, ScratchSpec } from "./models";
import type { StartScratchRunInput } from "./models";
import crypto from "node:crypto";
import { info } from "@argus/host/logger";
import { normalizeGuardrails } from "./guardrails";
import {
  createAutomation,
  createRun,
  getAutomationRun,
  scratchAutomationForRun,
} from "./manager";
import { executeRun } from "./runner";
import { dailyBudgetBlock } from "./spend";

const DEFAULT_NAME = "Quick run";

/** How an ad-hoc run's `trigger_reason` reads in the history. */
export const SCRATCH_TRIGGER_REASON = "ad-hoc";

function buildSpec(input: StartScratchRunInput): ScratchSpec {
  return {
    name: input.name?.trim() || DEFAULT_NAME,
    playbook: input.playbook,
    scope: { repo_roots: input.repo_roots ?? [] },
    source_ids: input.source_ids ?? [],
    model: input.model ?? null,
    guardrails: normalizeGuardrails(input.guardrails),
  };
}

/**
 * Run a playbook once. Returns as soon as the run record exists; progress is
 * published on `automation_run:changed` like any other run.
 */
export function startScratchRun(input: StartScratchRunInput): AutomationRun {
  if (!input.playbook.trim()) {
    throw "A playbook is required.";
  }

  const spec = buildSpec(input);

  // The daily budget is a limit on automation spend, not on scheduled spend —
  // an ad-hoc run is exactly the way someone would try to spend past it.
  const overBudget = dailyBudgetBlock();
  if (overBudget) {
    return createRun(
      crypto.randomUUID(),
      "skipped",
      SCRATCH_TRIGGER_REASON,
      `Skipped — ${overBudget}.`,
      spec,
    );
  }

  const run = createRun(
    crypto.randomUUID(),
    "running",
    SCRATCH_TRIGGER_REASON,
    null,
    spec,
  );
  const automation = scratchAutomationForRun(run);
  if (!automation) {
    throw "Could not build the run's spec.";
  }
  info(`Started ad-hoc automation run ${run.id}`);
  executeRun(automation, run.id);

  return run;
}

/**
 * Turn an ad-hoc run into a real automation, prefilled with the playbook and
 * scope it used. The bridge that makes a one-off the authoring path rather than
 * a dead end.
 *
 * The run itself stays ad-hoc: its history is what happened, and rewriting it
 * to point at an automation that did not exist at the time would be a lie.
 */
export function saveScratchRunAsAutomation(
  runId: string,
  overrides: { description?: string; enabled?: boolean; name?: string } = {},
): Automation {
  const run = getAutomationRun(runId);
  if (!run) {
    throw `Automation run not found: ${runId}`;
  }
  const spec = run.scratch;
  if (!spec) {
    throw "That run already belongs to an automation.";
  }

  return createAutomation({
    name: overrides.name?.trim() || spec.name,
    description: overrides.description ?? "",
    // Saved paused and manual: a run you did by hand once must not become a
    // clock you did not ask for.
    enabled: overrides.enabled ?? false,
    trigger: { kind: "manual" },
    scope: { repo_roots: [...spec.scope.repo_roots] },
    source_ids: [...spec.source_ids],
    playbook: spec.playbook,
    autonomy: null,
    guardrails: spec.guardrails,
    model: spec.model,
  });
}
