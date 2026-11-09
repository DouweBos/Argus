/**
 * An automation being edited, in the gateway's shape: what the editor holds,
 * what it sends back, and which projects it can offer.
 */

import type {
  AutomationInput,
  RemoteAutomationDetail,
  RemoteProject,
} from "@argus/remote-protocol";
import { cronError, DEFAULT_GUARDRAILS, localTimezone } from "./format";
import { onceError } from "./once";

export const DEFAULT_CRON = "0 9 * * 1-5";

export const NEW_PLAYBOOK = `# New automation

Describe what this run should do, in markdown. The agent reads the projects in
scope at their absolute paths and writes its findings as its final message.
`;

/** A fresh automation: paused, on a weekday-morning schedule, nothing in scope. */
export function newAutomationDraft(
  timezone: string = localTimezone(),
): RemoteAutomationDetail {
  return {
    id: "",
    name: "New automation",
    description: "",
    enabled: false,
    trigger_kind: "schedule",
    cron: DEFAULT_CRON,
    run_at: null,
    timezone,
    catch_up: true,
    repo_roots: [],
    source_ids: [],
    playbook: NEW_PLAYBOOK,
    extra_instructions: "",
    autonomy: null,
    model: null,
    runner: null,
    claude_account_id: null,
    guardrails: { ...DEFAULT_GUARDRAILS },
  };
}

/** What `automations.create` / `update` take, from what the editor holds. */
export function draftToInput(draft: RemoteAutomationDetail): AutomationInput {
  return {
    name: draft.name.trim() || "New automation",
    description: draft.description.trim(),
    enabled: draft.enabled,
    trigger_kind: draft.trigger_kind,
    cron: (draft.cron ?? DEFAULT_CRON).trim(),
    ...(draft.trigger_kind === "once" && { run_at: draft.run_at ?? "" }),
    timezone: draft.timezone?.trim() || localTimezone(),
    catch_up: draft.catch_up,
    repo_roots: draft.repo_roots,
    source_ids: draft.source_ids,
    playbook: draft.playbook,
    extra_instructions: draft.extra_instructions.trim(),
    autonomy: draft.autonomy,
    model: draft.model?.trim() || null,
    runner: draft.runner?.trim() || null,
    claude_account_id: draft.claude_account_id ?? null,
    guardrails: draft.guardrails,
  };
}

const CLAUDE_CODE_RUNNER_ID = "claude-code";

/**
 * Whether a run on this runner honours a Claude account pin. Custom runners
 * bring their own credentials; null is the computer's default runner.
 */
export function runnerTakesAccountPin(
  runnerId: string | null | undefined,
): boolean {
  return !runnerId || runnerId === CLAUDE_CODE_RUNNER_ID;
}

/**
 * Why the draft's schedule can't be saved, or null when it can. A paused
 * run-once may keep a past time — it is only checked once it would arm.
 */
export function draftScheduleError(
  draft: Pick<
    RemoteAutomationDetail,
    "cron" | "enabled" | "run_at" | "timezone" | "trigger_kind"
  >,
  now: number = Date.now(),
): string | null {
  const timezone = draft.timezone || localTimezone();
  switch (draft.trigger_kind) {
    case "schedule":
      return cronError((draft.cron ?? "").trim(), timezone);
    case "once": {
      const error = onceError(draft.run_at ?? "", timezone, now);

      return error && (draft.enabled || !draft.run_at) ? error : null;
    }
    case "manual":
      return null;
  }
}

/** Whether the editor differs from what the computer holds. */
export function draftChanged(
  draft: RemoteAutomationDetail,
  saved: RemoteAutomationDetail,
): boolean {
  return (
    JSON.stringify(draftToInput(draft)) !== JSON.stringify(draftToInput(saved))
  );
}

export interface ProjectOption {
  id: string;
  label: string;
  hint?: string;
}

/**
 * The computer's projects, plus any the draft still names that it no longer
 * lists — so one can be switched off rather than silently kept.
 */
export function automationProjectOptions(
  projects: Pick<RemoteProject, "name" | "repo_root">[],
  picked: string[],
): ProjectOption[] {
  const known = new Set(projects.map((p) => p.repo_root));

  return [
    ...projects.map((p) => ({ id: p.repo_root, label: p.name })),
    ...picked
      .filter((root) => !known.has(root))
      .map((root) => ({
        id: root,
        label: root.split("/").filter(Boolean).pop() ?? root,
        hint: "not open on this computer",
      })),
  ];
}
