import type { Equal, Expect } from "./typeEquality";
import type { AutomationDraft as HostAutomationDraft } from "../services/automation/authoring";
import type { GateLogEntry as HostGateLogEntry } from "../services/automation/gateLog";
import type {
  deleteAutomationMemory,
  listAutomationMemories,
} from "../services/automation/memory/service";
import type {
  Automation as HostAutomation,
  AutomationGuardrails as HostAutomationGuardrails,
  AutomationMemory as HostAutomationMemory,
  AutomationRun as HostAutomationRun,
  AutomationTrigger as HostAutomationTrigger,
  AutonomyLevel as HostAutonomyLevel,
  CreateAutomationInput as HostCreateAutomationInput,
  RunFeedbackNote as HostRunFeedbackNote,
  SaveMemoryInput as HostSaveMemoryInput,
  ScratchSpec as HostScratchSpec,
  StartScratchRunInput as HostStartScratchRunInput,
  UpdateAutomationInput as HostUpdateAutomationInput,
} from "../services/automation/models";
import type { AutomationCalibration as HostAutomationCalibration } from "../services/automation/outcomes";
import type { AcceptProposalResult as HostAcceptProposalResult } from "../services/automation/proposals/accept";
import type {
  Proposal as HostProposal,
  ProposalCta as HostProposalCta,
  ProposalSourceRef as HostProposalSourceRef,
  ProposalStatus as HostProposalStatus,
} from "../services/automation/proposals/models";
import type { RequestRevisionResult as HostRequestRevisionResult } from "../services/automation/proposals/revise";
import type { SignalSourceInfo as HostSignalSourceInfo } from "../services/signals/registry";
import type {
  AcceptProposalResult,
  Automation,
  AutomationCalibration,
  AutomationDraft,
  AutomationGuardrails,
  AutomationMemory,
  AutomationMemoryListing,
  AutomationRun,
  AutomationRunFeedback,
  AutomationScratchSpec,
  AutomationTrigger,
  AutonomyLevel,
  CreateAutomationInput,
  GateLogEntry,
  Proposal,
  ProposalCta,
  ProposalSourceRef,
  ProposalStatus,
  RequestRevisionResult,
  SaveAutomationMemoryInput,
  SignalSourceInfo,
  StartScratchRunInput,
  UpdateAutomationInput,
} from "@argus/remote-protocol";

export type AutomationModelChecks = [
  Expect<Equal<AutomationTrigger, HostAutomationTrigger>>,
  Expect<Equal<AutonomyLevel, HostAutonomyLevel>>,
  Expect<Equal<AutomationGuardrails, HostAutomationGuardrails>>,
  Expect<Equal<Automation, HostAutomation>>,
  Expect<Equal<AutomationScratchSpec, HostScratchSpec>>,
  Expect<Equal<StartScratchRunInput, HostStartScratchRunInput>>,
  Expect<Equal<AutomationRunFeedback, HostRunFeedbackNote>>,
  Expect<Equal<AutomationRun, HostAutomationRun>>,
  Expect<Equal<CreateAutomationInput, HostCreateAutomationInput>>,
  Expect<Equal<UpdateAutomationInput, HostUpdateAutomationInput>>,
  Expect<Equal<AutomationDraft, HostAutomationDraft>>,
  Expect<Equal<AutomationMemory, HostAutomationMemory>>,
  Expect<
    Equal<AutomationMemoryListing, ReturnType<typeof listAutomationMemories>>
  >,
  Expect<Equal<SaveAutomationMemoryInput, HostSaveMemoryInput>>,
  Expect<Equal<GateLogEntry, HostGateLogEntry>>,
  Expect<Equal<AutomationCalibration, HostAutomationCalibration>>,
  Expect<Equal<SignalSourceInfo, HostSignalSourceInfo>>,
  Expect<Equal<ProposalStatus, HostProposalStatus>>,
  Expect<Equal<ProposalCta, HostProposalCta>>,
  Expect<Equal<ProposalSourceRef, HostProposalSourceRef>>,
  Expect<Equal<Proposal, HostProposal>>,
  Expect<Equal<AcceptProposalResult, HostAcceptProposalResult>>,
  Expect<Equal<RequestRevisionResult, HostRequestRevisionResult>>,
  Expect<Equal<ReturnType<typeof deleteAutomationMemory>, void>>,
];
