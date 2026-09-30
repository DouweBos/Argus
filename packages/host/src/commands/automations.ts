import {
  draftAutomation,
  revisePlaybook,
} from "../services/automation/authoring";
import { submitRunFeedback } from "../services/automation/feedback";
import {
  clearGateLog,
  dismissGateLogEntry,
  listGateLog,
} from "../services/automation/gateLog";
import {
  createAutomation,
  deleteAutomation,
  deleteRun,
  getAutomationRun,
  listAutomationRuns,
  listAutomations,
  listScratchRuns,
  markRunReportRead,
  setAutomationEnabled,
  updateAutomation,
} from "../services/automation/manager";
import {
  deleteAutomationMemory,
  listAutomationMemories,
  saveAutomationMemory,
} from "../services/automation/memory/service";
import { calibrationFor } from "../services/automation/outcomes";
import { acceptProposal } from "../services/automation/proposals/accept";
import { performProposalCleanup } from "../services/automation/proposals/cleanup";
import {
  dismissProposal,
  getProposal,
  listProposals,
  resolveProposal,
} from "../services/automation/proposals/manager";
import { requestProposalRevision } from "../services/automation/proposals/revise";
import {
  cancelAutomationRun,
  startAutomationRun,
} from "../services/automation/runner";
import {
  saveScratchRunAsAutomation,
  startScratchRun,
} from "../services/automation/scratch";
import { defineTypedCommand } from "../services/command/registry";
import { describeSignalSources } from "../services/signals/registry";

export function registerAutomationCommands(): void {
  defineTypedCommand("automations_list", () => listAutomations());
  defineTypedCommand("automation_create", (p) => createAutomation(p.input));
  defineTypedCommand("automation_update", (p) =>
    updateAutomation(p.id, p.patch),
  );
  defineTypedCommand("automation_delete", (p) => deleteAutomation(p.id));
  defineTypedCommand("automation_set_enabled", (p) =>
    setAutomationEnabled(p.id, p.enabled),
  );
  defineTypedCommand("automation_run_now", (p) =>
    startAutomationRun(p.id, "manual"),
  );
  defineTypedCommand("automation_cancel_run", (p) =>
    cancelAutomationRun(p.runId),
  );
  defineTypedCommand("automation_runs_list", (p) =>
    listAutomationRuns(p.automationId),
  );
  defineTypedCommand("automation_run_get", (p) => getAutomationRun(p.runId));
  defineTypedCommand("automation_run_mark_read", (p) =>
    markRunReportRead(p.runId),
  );
  defineTypedCommand("automation_run_delete", (p) => deleteRun(p.runId));
  defineTypedCommand("automation_run_feedback", (p) =>
    submitRunFeedback({
      runId: p.runId,
      note: p.note,
      allowClearing: p.allowClearing,
    }),
  );
  defineTypedCommand("signal_sources_list", () => describeSignalSources());
  defineTypedCommand("automation_gate_log_list", () => listGateLog());
  defineTypedCommand("automation_gate_log_dismiss", (p) =>
    dismissGateLogEntry(p.id),
  );
  defineTypedCommand("automation_gate_log_clear", () => clearGateLog());
  defineTypedCommand("automation_draft", (p) =>
    draftAutomation({ description: p.description, timezone: p.timezone }),
  );
  defineTypedCommand("automation_playbook_revise", (p) =>
    revisePlaybook({
      playbook: p.playbook,
      instruction: p.instruction,
      name: p.name,
    }),
  );
  defineTypedCommand("automation_memories_list", (p) =>
    listAutomationMemories(p.automationId),
  );
  defineTypedCommand("automation_memory_save", (p) =>
    saveAutomationMemory(p.automationId, p.input),
  );
  defineTypedCommand("automation_memory_delete", (p) =>
    deleteAutomationMemory(p.automationId, p.name),
  );
  defineTypedCommand("automation_calibration", (p) =>
    calibrationFor(p.automationId),
  );
  defineTypedCommand("automation_run_scratch", (p) => startScratchRun(p.input));
  defineTypedCommand("automation_scratch_save", (p) =>
    saveScratchRunAsAutomation(p.runId, {
      name: p.name,
      description: p.description,
    }),
  );
  defineTypedCommand("automation_scratch_runs_list", () => listScratchRuns());

  defineTypedCommand("proposals_list", (p) =>
    listProposals({
      automationId: p.automationId,
      runId: p.runId,
      status: p.status,
    }),
  );
  defineTypedCommand("proposal_get", (p) => getProposal(p.id));
  defineTypedCommand("proposal_accept", (p) =>
    acceptProposal(p.id, { note: p.note }),
  );
  defineTypedCommand("proposal_request_revision", (p) =>
    requestProposalRevision(p.id, p.note),
  );
  defineTypedCommand("proposal_perform_cleanup", (p) =>
    performProposalCleanup(p.id),
  );
  defineTypedCommand("proposal_dismiss", (p) =>
    dismissProposal(p.id, p.reason),
  );
  defineTypedCommand("proposal_resolve", (p) => resolveProposal(p.id, p.note));
}
