export const ONBOARDING_STEPS = ["welcome", "telemetry"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStateData {
  completed: boolean;
  version: number;
  lastStep: OnboardingStep;
  skipped: string[];
  completedAt: number | null;
}

export interface OnboardingConfigFile {
  onboarding: OnboardingStateData;
  recentProjects: string[];
}

export const PREREQ_IDS = [
  "claude_cli",
  "claude_auth",
  "git_cli",
  "git_identity",
  "xcode",
  "ios_runtimes",
  "android_sdk",
  "android_avd",
  "playwright",
] as const;

export type PrereqId = (typeof PREREQ_IDS)[number];

export type PrereqStatus = "fail" | "pass" | "running" | "skipped" | "warn";

/** Why the Claude auth check is unhappy — the home banner words itself off this. */
export type ClaudeAuthReason =
  | "all_rate_limited"
  | "no_accounts"
  | "selected_rate_limited"
  | "selected_signed_out"
  | "unauthenticated"
  | "unverifiable";

export interface PrereqResult {
  id: PrereqId;
  status: PrereqStatus;
  message?: string;
  detail?: string;
  /** If true, the UI can offer a "Fix" action. */
  fixable?: boolean;
  /** True when a missing soft check only blocks mobile previews. */
  mobileOnly?: boolean;
  /** Set on `claude_auth` when it isn't passing. */
  auth_reason?: ClaudeAuthReason;
}

export interface PrereqUpdateEvent {
  id: PrereqId;
  status: PrereqStatus;
  message?: string;
  detail?: string;
  fixable?: boolean;
  mobileOnly?: boolean;
}

export type DetectedSignalKind =
  | "framework"
  | "monorepo"
  | "native"
  | "platform"
  | "project"
  | "tooling";

export interface DetectedSignal {
  detail?: string;
  kind: DetectedSignalKind;
  label: string;
}

export interface ArgusConfigSuggestion {
  config: Record<string, unknown>;
  inferredFrom: string[];
  signals: DetectedSignal[];
}
