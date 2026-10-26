import { z } from "zod";

export const ONBOARDING_STEPS = ["welcome", "telemetry", "projects"] as const;
export const OnboardingStep = z.enum(ONBOARDING_STEPS);
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export const OnboardingStateData = z.object({
  completed: z.boolean(),
  version: z.number(),
  lastStep: OnboardingStep,
  skipped: z.array(z.string()),
  completedAt: z.number().nullable(),
});
export type OnboardingStateData = z.infer<typeof OnboardingStateData>;

export const OnboardingConfigFile = z.object({
  onboarding: OnboardingStateData,
  recentProjects: z.array(z.string()),
});
export type OnboardingConfigFile = z.infer<typeof OnboardingConfigFile>;

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
export const PrereqId = z.enum(PREREQ_IDS);
export type PrereqId = z.infer<typeof PrereqId>;

export const PrereqStatus = z.enum([
  "fail",
  "pass",
  "running",
  "skipped",
  "warn",
]);
export type PrereqStatus = z.infer<typeof PrereqStatus>;

/** Why the Claude auth check is unhappy — the home banner words itself off this. */
export const ClaudeAuthReason = z.enum([
  "all_rate_limited",
  "no_accounts",
  "selected_rate_limited",
  "selected_signed_out",
  "unauthenticated",
  "unverifiable",
]);
export type ClaudeAuthReason = z.infer<typeof ClaudeAuthReason>;

export const PrereqResult = z.object({
  id: PrereqId,
  status: PrereqStatus,
  message: z.string().optional(),
  detail: z.string().optional(),
  /** If true, the UI can offer a "Fix" action. */
  fixable: z.boolean().optional(),
  /** True when a missing soft check only blocks mobile previews. */
  mobileOnly: z.boolean().optional(),
  /** Set on `claude_auth` when it isn't passing. */
  auth_reason: ClaudeAuthReason.optional(),
});
export type PrereqResult = z.infer<typeof PrereqResult>;

/** Outcome of a one-shot action that reports failure as a value. */
export const OkOrError = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type OkOrError = z.infer<typeof OkOrError>;

export const DetectedSignalKind = z.enum([
  "framework",
  "monorepo",
  "native",
  "platform",
  "project",
  "tooling",
]);
export type DetectedSignalKind = z.infer<typeof DetectedSignalKind>;

export const DetectedSignal = z.object({
  detail: z.string().optional(),
  kind: DetectedSignalKind,
  label: z.string(),
});
export type DetectedSignal = z.infer<typeof DetectedSignal>;

/** A `.argus.json` inferred from the repo, with what it was inferred from. */
export const ArgusConfigSuggestion = z.object({
  config: z.record(z.string(), z.unknown()),
  inferredFrom: z.array(z.string()),
  signals: z.array(DetectedSignal),
});
export type ArgusConfigSuggestion = z.infer<typeof ArgusConfigSuggestion>;

export const ExampleProject = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  platform: z.enum(["android", "ios", "web"]),
  repo: z.string(),
});
export type ExampleProject = z.infer<typeof ExampleProject>;

/** Current Claude CLI account, mirrors `claude auth status --json`. */
export const ClaudeAuthStatus = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  apiProvider: z.string().optional(),
  email: z.string().optional(),
  orgId: z.string().optional(),
  orgName: z.string().optional(),
  subscriptionType: z.string().optional(),
});
export type ClaudeAuthStatus = z.infer<typeof ClaudeAuthStatus>;

/**
 * A Claude account Argus keeps signed in. Each one gets its own CLI config dir,
 * so identity and credentials belong to that account alone.
 */
export const ClaudeAccount = z.object({
  id: z.string(),
  /** User-editable display name. Falls back to the email when unset. */
  label: z.string().optional(),
  email: z.string().optional(),
  org_id: z.string().optional(),
  org_name: z.string().optional(),
  subscription_type: z.string().optional(),
  auth_method: z.string().optional(),
  /** Set when a run failed to authenticate — the row offers a re-login. */
  needs_reauth: z.boolean().optional(),
  /** Set when a run hit the plan's usage limit — credentials are fine. */
  rate_limited: z.boolean().optional(),
  account_type: z.enum(["claudeai", "console"]),
  created_at: z.number(),
});
export type ClaudeAccount = z.infer<typeof ClaudeAccount>;

export const ClaudeAccountsState = z.object({
  accounts: z.array(ClaudeAccount),
  activeId: z.string(),
});
export type ClaudeAccountsState = z.infer<typeof ClaudeAccountsState>;

/** Where an interactive Claude login wants the browser sent. */
export const ClaudeLoginUrl = z.object({ url: z.string() });
export type ClaudeLoginUrl = z.infer<typeof ClaudeLoginUrl>;
