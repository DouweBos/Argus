import { z } from "zod";
import {
  AcceptProposalResult,
  Automation,
  AutomationCalibration,
  AutomationDraft,
  AutomationMemory,
  AutomationMemoryListing,
  AutomationRun,
  CreateAutomationInput,
  GateLogEntry,
  Proposal,
  ProposalStatus,
  RequestRevisionResult,
  SaveAutomationMemoryInput,
  SignalSourceInfo,
  StartScratchRunInput,
  UpdateAutomationInput,
} from "../models/automations";
import { type CommandSpec, NoParams, Void } from "./spec";

const ById = z.object({ id: z.string() });
const ByRunId = z.object({ runId: z.string() });
const ByAutomationId = z.object({ automationId: z.string() });

/**
 * Automations and their proposals are host state, deliberately remotable so a
 * desktop driving a headless host manages its automations as its own.
 */
export const AUTOMATION_COMMANDS = {
  automations_list: {
    tier: "admin",
    params: NoParams,
    result: z.array(Automation),
  },
  automation_create: {
    tier: "admin",
    params: z.object({ input: CreateAutomationInput }),
    result: Automation,
  },
  automation_update: {
    tier: "admin",
    params: ById.extend({ patch: UpdateAutomationInput }),
    result: Automation,
  },
  automation_delete: { tier: "admin", params: ById, result: Void },
  automation_set_enabled: {
    tier: "admin",
    params: ById.extend({ enabled: z.boolean() }),
    result: Automation,
  },
  /** Fire now. Resolves once the run record exists, not when it ends. */
  automation_run_now: { tier: "admin", params: ById, result: AutomationRun },
  automation_cancel_run: {
    tier: "admin",
    params: ByRunId,
    result: AutomationRun,
  },
  automation_runs_list: {
    tier: "admin",
    params: z.object({ automationId: z.string().optional() }),
    result: z.array(AutomationRun),
  },
  automation_run_get: {
    tier: "admin",
    params: ByRunId,
    result: AutomationRun.nullable(),
  },
  automation_run_mark_read: {
    tier: "admin",
    params: ByRunId,
    result: AutomationRun,
  },
  /** Deletes the run's record, report and the proposals it emitted. */
  automation_run_delete: { tier: "admin", params: ByRunId, result: Void },
  /** Picks the run's own agent back up rather than firing the automation again. */
  automation_run_feedback: {
    tier: "admin",
    params: ByRunId.extend({
      note: z.string(),
      allowClearing: z.boolean().optional(),
    }),
    result: AutomationRun,
  },
  signal_sources_list: {
    tier: "admin",
    params: NoParams,
    result: z.array(SignalSourceInfo),
  },
  automation_gate_log_list: {
    tier: "admin",
    params: NoParams,
    result: z.array(GateLogEntry),
  },
  automation_gate_log_dismiss: { tier: "admin", params: ById, result: Void },
  automation_gate_log_clear: { tier: "admin", params: NoParams, result: Void },
  /** A draft to review — nothing is saved or enabled until the user saves. */
  automation_draft: {
    tier: "admin",
    params: z.object({
      description: z.string(),
      timezone: z.string().optional(),
    }),
    result: AutomationDraft,
  },
  /** The rewrite comes back as text for the editor; only a save persists it. */
  automation_playbook_revise: {
    tier: "admin",
    params: z.object({
      playbook: z.string(),
      instruction: z.string(),
      name: z.string().optional(),
    }),
    result: z.object({ playbook: z.string() }),
  },
  automation_memories_list: {
    tier: "admin",
    params: ByAutomationId,
    result: AutomationMemoryListing,
  },
  automation_memory_save: {
    tier: "admin",
    params: ByAutomationId.extend({ input: SaveAutomationMemoryInput }),
    result: AutomationMemory,
  },
  automation_memory_delete: {
    tier: "admin",
    params: ByAutomationId.extend({ name: z.string() }),
    result: Void,
  },
  automation_calibration: {
    tier: "admin",
    params: ByAutomationId,
    result: AutomationCalibration,
  },
  /** A playbook run once, with no automation persisted for it. */
  automation_run_scratch: {
    tier: "admin",
    params: z.object({ input: StartScratchRunInput }),
    result: AutomationRun,
  },
  /** Turn an ad-hoc run into a real automation, prefilled with what it ran. */
  automation_scratch_save: {
    tier: "admin",
    params: ByRunId.extend({
      name: z.string().optional(),
      description: z.string().optional(),
    }),
    result: Automation,
  },
  automation_scratch_runs_list: {
    tier: "admin",
    params: NoParams,
    result: z.array(AutomationRun),
  },
  /** Newest first. Optionally narrowed to one automation, run or status. */
  proposals_list: {
    tier: "admin",
    params: z.object({
      automationId: z.string().optional(),
      runId: z.string().optional(),
      status: ProposalStatus.optional(),
    }),
    result: z.array(Proposal),
  },
  proposal_get: { tier: "admin", params: ById, result: Proposal.nullable() },
  /** Creates the proposal's session and spawns an agent prompted with it. */
  proposal_accept: {
    tier: "admin",
    params: ById.extend({ note: z.string().optional() }),
    result: AcceptProposalResult,
  },
  proposal_request_revision: {
    tier: "admin",
    params: ById.extend({ note: z.string() }),
    result: RequestRevisionResult,
  },
  /** Carries out a cleanup CTA. Destructive; the caller confirms first. */
  proposal_perform_cleanup: { tier: "admin", params: ById, result: Proposal },
  proposal_dismiss: {
    tier: "admin",
    params: ById.extend({ reason: z.string().optional() }),
    result: Proposal,
  },
  proposal_resolve: {
    tier: "admin",
    params: ById.extend({ note: z.string().optional() }),
    result: Proposal,
  },
} as const satisfies Record<string, CommandSpec>;
