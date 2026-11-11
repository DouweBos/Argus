import { z } from "zod";

export const RunnerCapabilities = z.object({
  /** Whether the runner accepts an `--mcp-config` style server map. */
  supportsMcp: z.boolean(),
  /** Whether the runner supports forking a transcript at a turn (resume). */
  supportsTranscriptFork: z.boolean(),
  /** Whether the runner supports mid-session model switching. */
  supportsSetModel: z.boolean(),
  /** Whether the runner supports mid-session permission-mode switching. */
  supportsSetPermissionMode: z.boolean(),
  /** Whether the runner supports mid-session reasoning-effort switching. */
  supportsSetEffort: z.boolean(),
  /** Whether the runner supports a graceful interrupt without killing. */
  supportsInterrupt: z.boolean(),
  /** Whether a running agent can be asked a side question. */
  supportsSideQuestion: z.boolean(),
});
export type RunnerCapabilities = z.infer<typeof RunnerCapabilities>;

export const RunnerModelOption = z.object({
  /** Model id passed to the CLI. */
  value: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
});
export type RunnerModelOption = z.infer<typeof RunnerModelOption>;

/** How the picker installs a runner's CLI and signs in to it. */
export const RunnerSetup = z.object({
  /** Shell command that installs the CLI, when there is one. */
  installCommand: z.string().nullable(),
  /** Page to install it from when there's no command. */
  installUrl: z.string().nullable(),
  /** Shell command that signs in, run in a terminal. */
  loginCommand: z.string().nullable(),
});
export type RunnerSetup = z.infer<typeof RunnerSetup>;

/** Which half of a runner's setup to run. */
export const RunnerSetupStep = z.enum(["install", "login"]);
export type RunnerSetupStep = z.infer<typeof RunnerSetupStep>;

/** A setup step started: its terminal, or the page opened instead. */
export const RunnerSetupStarted = z.object({
  terminalId: z.string().nullable(),
  openedUrl: z.string().nullable(),
});
export type RunnerSetupStarted = z.infer<typeof RunnerSetupStarted>;

/** A registered LLM runner — the subset of the host's runner the UI needs. */
export const RegisteredRunner = z.object({
  /** Stable id, e.g. `"claude-code"`. */
  id: z.string(),
  /** Human-readable label, e.g. "Claude Code". */
  displayName: z.string(),
  capabilities: RunnerCapabilities,
  /** True for user-configured runners derived from an official one. */
  isCustom: z.boolean(),
  /** Official runner a custom runner derives from; null for built-ins. */
  baseRunnerId: z.string().nullable(),
  /**
   * Models the runner declares up front. Empty for runners that only learn
   * their model list from the live handshake (Claude Code).
   */
  models: z.array(RunnerModelOption),
  /** Model applied when nothing else pins one. */
  defaultModel: z.string().nullable(),
  /** False when the runner's CLI isn't installed; absent from older hosts. */
  available: z.boolean().optional(),
  /** How to install it, when unavailable. */
  unavailableReason: z.string().nullable().optional(),
  /** How Argus installs and signs in to it; absent when it can't. */
  setup: RunnerSetup.nullable().optional(),
});
export type RegisteredRunner = z.infer<typeof RegisteredRunner>;

export const CustomRunnerModel = z.object({
  /** Model id passed to the CLI, e.g. `callstack/Apex`. */
  id: z.string(),
  /** Label shown in the model picker. */
  displayName: z.string(),
  /** Optional second line in the picker. */
  description: z.string().optional(),
});
export type CustomRunnerModel = z.infer<typeof CustomRunnerModel>;

/** A user-configured runner, persisted in `~/.argus/custom-runners.json`. */
export const CustomRunner = z.object({
  /** Stable id, always `custom:<slug>`. */
  id: z.string(),
  /** Label shown wherever runners are listed. */
  displayName: z.string(),
  /** Official runner this one derives from, e.g. `claude-code`. */
  baseRunnerId: z.string(),
  /**
   * Environment overrides applied on top of the base runner's env for every
   * spawn and one-shot. An empty value unsets an inherited variable.
   */
  env: z.record(z.string(), z.string()),
  /** Models offered in the picker. Empty falls back to the base runner's. */
  models: z.array(CustomRunnerModel),
  /** Model used when nothing else pins one. */
  defaultModel: z.string().nullable(),
});
export type CustomRunner = z.infer<typeof CustomRunner>;

/** A custom runner as edited — no id until it is first saved. */
export const CustomRunnerConfig = CustomRunner.partial({ id: true });
export type CustomRunnerConfig = z.infer<typeof CustomRunnerConfig>;

/** Pre-filled starting point offered in the "Add runner" menu. */
export const CustomRunnerPreset = z.object({
  /** Stable preset key, e.g. `apex`. */
  key: z.string(),
  /** Label shown in the "Add runner" menu. */
  label: z.string(),
  /** One-liner describing the provider. */
  description: z.string(),
  /** Env var the user must fill in with their key/token. */
  secretEnvKey: z.string(),
  /** Draft config, with the secret env var left blank. */
  draft: CustomRunner.omit({ id: true }),
});
export type CustomRunnerPreset = z.infer<typeof CustomRunnerPreset>;
