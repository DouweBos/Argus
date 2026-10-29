import { z } from "zod";
import { TOOL_IDS } from "../commands/spec";
import { AutonomyLevel } from "./automations";

/** Colour theme presets; ids match `html[data-color-theme]` in Peacock. */
export const ColorTheme = z.enum([
  "amber",
  "ember",
  "grove",
  "iris",
  "muted",
  "ocean",
  "rose",
]);
export type ColorTheme = z.infer<typeof ColorTheme>;

/** Machine-local app settings persisted in `~/.argus/app-settings.json`. */
export const AppSettings = z.object({
  /**
   * Base directory new worktrees are created in, for every project that does
   * not set its own. Absent means `<argusHome>/worktrees`.
   */
  worktrees_base_dir: z.string().optional(),
  /**
   * Base directory worktrees opened by automations are created in. Absent
   * falls through to `worktrees_base_dir`.
   */
  automation_worktrees_base_dir: z.string().optional(),
  /** App-level default LLM picked in Settings, mirrored for the host. */
  default_llm: z
    .object({
      model: z.string().nullish(),
      runner: z.string().nullish(),
    })
    .optional(),
  /** User-defined MCP servers merged into every spawned agent. */
  mcp_servers: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .optional(),
  /**
   * Auto-updater feed channel. `latest` is the public production feed; `beta`
   * subscribes to in-development builds cut from `main`. Defaults to `latest`.
   */
  updater_channel: z.enum(["beta", "latest"]).optional(),
  /**
   * Headless server only: install a downloaded update and restart as soon as
   * no agent is running. Off by default.
   */
  server_auto_install_updates: z.boolean().optional(),
  /**
   * Master switch for the automation scheduler. Defaults to true; manual runs
   * work regardless.
   */
  automations_enabled: z.boolean().optional(),
  /** Suggest replies after a turn ends, from the agent's last message. Defaults to true. */
  follow_up_suggestions: z.boolean().optional(),
  /** Warm agents kept ready for the sessions clients show, 0 for none. Defaults to 1. */
  warm_agents: z.number().int().min(0).max(2).optional(),
  /** Screen Argus opens on: the project picker, or the inbox. Defaults to home. */
  launch_route: z.enum(["home", "inbox"]).optional(),
  /** Move a Linear issue to its team's started state when a session starts from it. Defaults to true. */
  linear_mark_started: z.boolean().optional(),
  /** When to comment on a session's Linear issue with a summary and screenshots. Defaults to `pr`. */
  linear_report: z.enum(["off", "pr", "merge"]).optional(),
  /**
   * App-wide cap on how far any automation may go. Unset or null means no
   * cap — the automation's own level stands. A project can cap it lower,
   * never higher.
   */
  default_autonomy: AutonomyLevel.nullish(),
  /** Auto-started automation sessions allowed at once. Defaults to 3. */
  max_concurrent_automation_sessions: z.number().optional(),
  /** Spend automations may reach in a day, in USD. 0 or unset = no budget. */
  automation_daily_budget_usd: z.number().optional(),
  /**
   * Extra shell commands a read-only automation may run, beyond the built-in
   * reads. A bare command or a prefix. Machine-local: a project cannot widen
   * it, or a repo could authorise itself.
   */
  automation_allowed_commands: z.array(z.string()).optional(),
  /** Extra tools a read-only automation may call, by exact name. */
  automation_allowed_tools: z.array(z.string()).optional(),
  /**
   * Master kill-switch for phone remote access. When false (default) the local
   * gateway + tunnel stay down and pairing is refused.
   */
  remote_enabled: z.boolean().optional(),
  // Tunnels an earlier version let the user configure. No longer settable:
  // read only to keep one running until the managed tunnel replaces it.
  remote_provider: z.enum(["cloudflare", "none", "tailscale"]).optional(),
  remote_tailscale_enabled: z.boolean().optional(),
  remote_cloudflare_enabled: z.boolean().optional(),
  remote_tunnel_mode: z.enum(["quick", "token"]).optional(),
  remote_tunnel_token: z.string().optional(),
  remote_public_url: z.string().optional(),
  /**
   * Serve the web client on the LAN. Access is still gated by Noise pairing;
   * this only changes reachability.
   */
  /**
   * Mirror notifications to paired devices even while the Argus window is
   * focused. Off by default.
   */
  remote_notify_when_focused: z.boolean().optional(),
  // Preferences both desktop apps (Electron and Argus for Mac) read and write.
  theme: z.enum(["dark", "light", "system"]).optional(),
  /** Accent and surface tint layered on the scheme. Absent means muted. */
  color_theme: ColorTheme.optional(),
  /** Pull chats run with the plain Claude Code CLI into project history. On by default. */
  import_cli_chats: z.boolean().optional(),
  /** Display size. */
  ui_scale: z
    .enum(["default", "large", "larger", "small", "smaller"])
    .optional(),
  /** Permission mode for agents started without one. */
  default_permission_mode: z
    .enum(["ask", "auto", "plan", "review", "trusted"])
    .optional(),
  /** Model seeded into new sessions; empty means the CLI's own default. */
  default_model: z.string().optional(),
  custom_editors: z
    .array(z.object({ id: z.string(), name: z.string(), command: z.string() }))
    .optional(),
  /** Name shown to guests in huddles this machine hosts. */
  huddle_display_name: z.string().optional(),
  /** Telemetry consent; the host applies it at boot. */
  telemetry_mode: z.enum(["full", "presence"]).optional(),
  /** Changed files as a flat list or a tree. */
  git_file_view: z.enum(["flat", "tree"]).optional(),
  git_diff_layout: z.enum(["split", "unified"]).optional(),
  git_ignore_whitespace: z.boolean().optional(),
});
export type AppSettings = z.infer<typeof AppSettings>;

export const DependencySeverity = z.enum(["optional", "required"]);
export type DependencySeverity = z.infer<typeof DependencySeverity>;

/** `NodeJS.Platform`, spelled out so the wire does not depend on Node types. */
export const HostOsPlatform = z.enum([
  "aix",
  "android",
  "cygwin",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
  "win32",
]);
export type HostOsPlatform = z.infer<typeof HostOsPlatform>;

export const DependencyStatus = z.object({
  /** Machine-readable id, e.g. "claude". */
  id: z.string(),
  /** User-facing name, e.g. "Claude Code CLI". */
  name: z.string(),
  /** What this dep unlocks — shown in the "missing" message. */
  purpose: z.string(),
  /** `required` deps break core functionality; `optional` deps gate a feature. */
  severity: DependencySeverity,
  installed: z.boolean(),
  /** Platforms where this dep is relevant. */
  platforms: z.array(HostOsPlatform),
  /** Resolved absolute path, when installed. */
  resolvedPath: z.string().optional(),
  /** Installation hint to show when missing. */
  hint: z.string(),
});
export type DependencyStatus = z.infer<typeof DependencyStatus>;

export const DependencyReport = z.object({
  dependencies: z.array(DependencyStatus),
  missingRequired: z.number(),
  missingOptional: z.number(),
  /** Platform the checks ran on — the UI tailors wording to it. */
  platform: HostOsPlatform,
});
export type DependencyReport = z.infer<typeof DependencyReport>;

export const EditorDescriptor = z.object({
  id: z.string(),
  name: z.string(),
  available: z.boolean(),
});
export type EditorDescriptor = z.infer<typeof EditorDescriptor>;

/** The user's per-tool enable map; absent tools use their default. */
export const EnabledTools = z.partialRecord(z.enum(TOOL_IDS), z.boolean());
export type EnabledTools = z.infer<typeof EnabledTools>;

export const ConductorStatus = z.object({
  /** Version pinned by the user, or null when using the bundled default. */
  overrideVersion: z.string().nullable(),
  /** Version currently resolved for invocations (override when ready, else bundled). */
  activeVersion: z.string().nullable(),
  /** Version baked into this app build. */
  bundledVersion: z.string().nullable(),
  state: z.enum(["error", "idle", "installing", "ready"]),
  error: z.string().nullable(),
});
export type ConductorStatus = z.infer<typeof ConductorStatus>;

/** A store the host seals with its secret storage. */
export const SecretStoreId = z.enum(["mcp_tokens", "remote_devices"]);
export type SecretStoreId = z.infer<typeof SecretStoreId>;

export const TelemetryMode = z.enum(["full", "presence"]);
export type TelemetryMode = z.infer<typeof TelemetryMode>;

export const TelemetryInit = z.object({
  /** Anonymous install id. */
  distinctId: z.string(),
  mode: TelemetryMode,
  /** False when no PostHog key is baked into the build. */
  configured: z.boolean(),
  appVersion: z.string(),
});
export type TelemetryInit = z.infer<typeof TelemetryInit>;
