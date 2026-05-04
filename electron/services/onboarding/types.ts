export const ONBOARDING_STEPS = [
  "welcome",
  "permissions",
  "plugins",
  "preflight",
  "claude_auth",
  "launcher",
  "telemetry",
  "completion",
] as const;

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
  "native_bridge",
  "xcode",
  "ios_runtimes",
  "android_sdk",
  "android_avd",
  "playwright",
] as const;

export type PrereqId = (typeof PREREQ_IDS)[number];

export type PrereqStatus = "fail" | "pass" | "running" | "skipped" | "warn";

export interface PrereqResult {
  id: PrereqId;
  status: PrereqStatus;
  message?: string;
  detail?: string;
  /** If true, the UI can offer a "Fix" action. */
  fixable?: boolean;
  /** True when a missing soft check only blocks mobile previews. */
  mobileOnly?: boolean;
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
