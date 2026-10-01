import { z } from "zod";
import { TOOL_IDS } from "../commands/spec";
import { AutonomyLevel } from "./automations";

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
  /** Screen Argus opens on: the project picker, or the inbox. Defaults to home. */
  launch_route: z.enum(["home", "inbox"]).optional(),
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
  /**
   * @deprecated Superseded by the per-provider `remote_*_enabled` flags. Still
   * read once to migrate installs that predate concurrent providers.
   */
  remote_provider: z.enum(["cloudflare", "none", "tailscale"]).optional(),
  /** Run `tailscale funnel` alongside any other provider. */
  remote_tailscale_enabled: z.boolean().optional(),
  /** Run `cloudflared` alongside any other provider. */
  remote_cloudflare_enabled: z.boolean().optional(),
  /**
   * Cloudflare tunnel mode: "quick" (ephemeral trycloudflare URL, no account)
   * or "token" (stable named tunnel via a connector token). Defaults to quick.
   */
  remote_tunnel_mode: z.enum(["quick", "token"]).optional(),
  /** Cloudflare connector token for a named tunnel (token mode). */
  remote_tunnel_token: z.string().optional(),
  /** Stable public URL for the named tunnel, configured in Cloudflare. */
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
