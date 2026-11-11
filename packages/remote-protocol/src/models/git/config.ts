/** `.argus.json` (checked in) and the per-developer project settings beside it. */

import { z } from "zod";
import { ReleaseNotePatternConfig } from "./releaseNotes";

/** A `setup.copy` / `setup.symlink` entry: a bare path/glob, or one with excludes. */
export const SetupCopyEntry = z.union([
  z.string(),
  z.object({ path: z.string(), exclude: z.array(z.string()).optional() }),
]);
export type SetupCopyEntry = z.infer<typeof SetupCopyEntry>;

export const ArgusSetupConfig = z.object({
  /** Directories/files to copy from the main repo into the new worktree. */
  copy: z.array(SetupCopyEntry),
  /** Files to symlink from the main repo into the new worktree. */
  symlink: z.array(SetupCopyEntry),
  /** Shell commands run inside the new worktree after copy/symlink. */
  commands: z.array(z.string()),
});
export type ArgusSetupConfig = z.infer<typeof ArgusSetupConfig>;

export const ArgusTerminalConfig = z.object({
  /** Human-readable label shown on the tab. */
  name: z.string(),
  /** Relative directory (from the session root) to start the shell in. */
  dir: z.string(),
});
export type ArgusTerminalConfig = z.infer<typeof ArgusTerminalConfig>;

export const WorkspaceEnvStrategy = z.enum(["hash", "sequential"]);
export type WorkspaceEnvStrategy = z.infer<typeof WorkspaceEnvStrategy>;

export const WorkspaceEnvConfig = z.object({
  /** Env var name (e.g. `ARGUS_PORT`, `RCT_METRO_PORT`). */
  name: z.string(),
  /** Starting integer. Final value is `base_value + offset`. */
  base_value: z.number(),
  /** Modulus for the hash strategy (default 1000). */
  range: z.number(),
  /** How to compute the per-session offset. */
  strategy: WorkspaceEnvStrategy,
});
export type WorkspaceEnvConfig = z.infer<typeof WorkspaceEnvConfig>;

/** A single entry in `.argus.json` `run` — a labelled shell command. */
export const ArgusRunCommand = z.object({
  /** User-visible label for the command (also used as its identifier). */
  title: z.string(),
  /** Shell command to execute (e.g. `npx expo start`). */
  command: z.string(),
  /** Relative directory (from the session root) to run in. Defaults to the root. */
  cwd: z.string().optional(),
  /** Re-running kills the existing session with the same title first. */
  restartOnRerun: z.boolean(),
  /** Titles of other run commands that must already be running first. */
  requires: z.array(z.string()).optional(),
});
export type ArgusRunCommand = z.infer<typeof ArgusRunCommand>;

/** A related project that agents can spawn worktrees in. */
export const RelatedProject = z.object({
  /** Relative path from this project's root to the related project's root. */
  path: z.string(),
  /** Human-readable description of what this project is. */
  description: z.string(),
});
export type RelatedProject = z.infer<typeof RelatedProject>;

/** JSON-facing shape for custom browser device presets in `.argus.json`. */
export const BrowserPresetConfig = z.object({
  /** Viewport height in CSS pixels. */
  height: z.number(),
  /** Unique preset identifier (e.g. "iphone-15-pro"). */
  id: z.string(),
  /** Display name shown in the preset picker. Defaults to `id`. */
  label: z.string().optional(),
  /** Custom user-agent string. Defaults to a desktop Chrome UA. */
  user_agent: z.string().optional(),
  /** Viewport width in CSS pixels. */
  width: z.number(),
});
export type BrowserPresetConfig = z.infer<typeof BrowserPresetConfig>;

/**
 * A deep link entry surfaced by the runtime toolbar's "Link" dropdown: a leaf
 * link, or a folder grouping nested entries.
 */
export interface SimulatorDeeplinkConfig {
  /** Display name shown in the dropdown (e.g. "Settings", "Profile"). */
  label: string;
  /** URL or custom-scheme deep link. Leaf entries only. */
  url?: string;
  /** Nested entries when this is a folder. Mutually exclusive with `url`. */
  children?: SimulatorDeeplinkConfig[];
}
export const SimulatorDeeplinkConfig: z.ZodType<SimulatorDeeplinkConfig> =
  z.lazy(() =>
    z.object({
      label: z.string(),
      url: z.string().optional(),
      children: z.array(SimulatorDeeplinkConfig).optional(),
    }),
  );

export const ArgusLlmConfig = z.object({
  /** Runner id, e.g. "claude-code". Absent falls back to the app default. */
  runner: z.string().nullish(),
  /** Default model id for this project. Absent lets the runner pick. */
  model: z.string().nullish(),
});
export type ArgusLlmConfig = z.infer<typeof ArgusLlmConfig>;

const AutonomyCeiling = z.enum(["auto_merge", "draft", "pr", "propose"]);

/** The `automations` block of `.argus.json`. */
export const ProjectAutomationConfig = z.object({
  /** Highest rung any automation may reach in this repo. */
  autonomy_ceiling: AutonomyCeiling.nullish(),
  /** Automation ids or template ids this repo opts out of entirely. */
  disabled: z.array(z.string()).optional(),
  /** Globs no automation-started branch may touch. Added to the automation's own list. */
  path_denylist: z.array(z.string()).optional(),
});
export type ProjectAutomationConfig = z.infer<typeof ProjectAutomationConfig>;

/** The `verify` block of `.argus.json`: how an agent proves its work. */
export const VerifyConfig = z.object({
  /** Commands that must pass after the last code change. */
  checks: z.array(z.string()),
  /** How to sign in before driving the app: a `/skill` or a shell command. */
  sign_in: z.string().nullish(),
  /** Screenshot each device before changing code. Defaults to true. */
  baseline: z.boolean().nullish(),
  /** How to slow the backend down so loading states can be checked. */
  slow_backend: z.string().nullish(),
});
export type VerifyConfig = z.infer<typeof VerifyConfig>;

/** A project's `.argus.json`, normalized. */
export const ArgusConfig = z.object({
  /** Setup instructions run once when a new session is created. */
  setup: ArgusSetupConfig,
  /** Terminals to auto-open when a session is selected. */
  terminals: z.array(ArgusTerminalConfig),
  /** Env vars with a unique integer per session (e.g. for port allocation). */
  workspace_env: z.array(WorkspaceEnvConfig),
  /** Ordered list of run commands shown in the app's run menu. */
  run: z.array(ArgusRunCommand),
  /** Related projects that agents can create worktrees in and work on. */
  related_projects: z.array(RelatedProject).optional(),
  /** Default URL to load in the embedded web browser. */
  browser_url: z.string().nullish(),
  /** Custom browser device presets for the web browser panel. */
  browser_presets: z.array(BrowserPresetConfig),
  /** Branches updated through a pull request instead of a direct merge. */
  protected_branches: z.array(z.string()),
  /** Preferred default source branch for new sessions. */
  default_base_branch: z.string().nullish(),
  /** Only one runtime may be active across all of this project's sessions. */
  single_runtime: z.boolean().nullish(),
  /** Send "continue" to an agent stalled on a plan limit once it resets. */
  auto_continue_on_limit: z.boolean().nullish(),
  /** Glob-driven release-note patterns surfaced on the session home screen. */
  release_note_patterns: z.array(ReleaseNotePatternConfig),
  /** Deep links surfaced as a dropdown on the runtime toolbar's "Link" button. */
  simulator_deeplinks: z.array(SimulatorDeeplinkConfig),
  /** Minutes between background `git fetch --prune` runs. 0 or absent disables it. */
  auto_fetch_minutes: z.number().nullish(),
  /** Project-level default LLM runner + model. */
  llm: ArgusLlmConfig.nullish(),
  /** Tools disabled for everyone working on this project. */
  tools: z.object({ disabled: z.array(z.string()).optional() }).nullish(),
  /** How far Argus automations may go in this repo. */
  automations: ProjectAutomationConfig.nullish(),
  /** How an agent proves its work on this project; drives `/implement-ticket`. */
  verify: VerifyConfig.nullish(),
});
export type ArgusConfig = z.infer<typeof ArgusConfig>;

/**
 * Per-developer, per-project preferences, stored in the user's home
 * directory rather than the repo.
 */
export const UserProjectSettings = z.object({
  /** Required prefix applied to newly created branches. Empty disables it. */
  branch_prefix: z.string().optional(),
  /** Branch names hidden from the sidebar Branches list. Git is untouched. */
  archived_branches: z.array(z.string()).optional(),
  /** Branch names pinned for quick access. */
  pinned_branches: z.array(z.string()).optional(),
  /** Hide git-lfs warning banners for this project. */
  suppress_lfs_warning: z.boolean().optional(),
  /** Base directory this project's worktrees are created in. */
  worktrees_base_dir: z.string().optional(),
  /** Base directory automation worktrees are created in for this project. */
  automation_worktrees_base_dir: z.string().optional(),
  /** Roots worktrees used to live under, kept visible until moved or deleted. */
  previous_worktrees_roots: z.array(z.string()).optional(),
});
export type UserProjectSettings = z.infer<typeof UserProjectSettings>;
