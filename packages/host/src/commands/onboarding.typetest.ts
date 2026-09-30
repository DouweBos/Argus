import type { Equal, Expect } from "./typeEquality";
import type { ClaudeAccountsState as HostClaudeAccountsState } from "../services/claudeAuth/accountActions";
import type { ClaudeAccount as HostClaudeAccount } from "../services/claudeAuth/accounts";
import type { ClaudeAuthStatus as HostClaudeAuthStatus } from "../services/claudeAuth/claudeAuth";
import type { ExampleProject as HostExampleProject } from "../services/onboarding/examples";
import type {
  ArgusConfigSuggestion as HostArgusConfigSuggestion,
  DetectedSignal as HostDetectedSignal,
  OnboardingConfigFile as HostOnboardingConfigFile,
  OnboardingStateData as HostOnboardingStateData,
  PrereqResult as HostPrereqResult,
} from "../services/onboarding/types";
import type {
  ArgusConfigSuggestion,
  ClaudeAccount,
  ClaudeAccountsState,
  ClaudeAuthStatus,
  DetectedSignal,
  ExampleProject,
  OnboardingConfigFile,
  OnboardingStateData,
  PrereqResult,
} from "@argus/remote-protocol";

export type OnboardingModelChecks = [
  Expect<Equal<OnboardingStateData, HostOnboardingStateData>>,
  Expect<Equal<OnboardingConfigFile, HostOnboardingConfigFile>>,
  Expect<Equal<PrereqResult, HostPrereqResult>>,
  Expect<Equal<DetectedSignal, HostDetectedSignal>>,
  Expect<Equal<ArgusConfigSuggestion, HostArgusConfigSuggestion>>,
  Expect<Equal<ExampleProject, HostExampleProject>>,
  Expect<Equal<ClaudeAuthStatus, HostClaudeAuthStatus>>,
  Expect<Equal<ClaudeAccount, HostClaudeAccount>>,
  Expect<Equal<ClaudeAccountsState, HostClaudeAccountsState>>,
];
