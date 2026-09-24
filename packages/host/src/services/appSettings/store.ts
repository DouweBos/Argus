/**
 * Machine-local app settings stored at `~/.argus/app-settings.json`.
 *
 * Holds preferences that need to be readable from the main process (so they
 * can affect how subprocesses are spawned) and persisted across app restarts.
 * Per-developer; never written into the repository.
 */

import type { AutonomyLevel } from "../automation/models";
import type { McpServers } from "../mcp/userConfig";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { invalidateWorktreeLocationCache } from "../session/worktreeRootCache";

const SCHEMA_VERSION = 1;

export interface AppSettings {
  /**
   * Base directory new worktrees are created in, for every project that does
   * not set its own. Absent means `<argusHome>/worktrees`.
   */
  worktrees_base_dir?: string;
  /**
   * Base directory worktrees opened by automations are created in. Automations
   * produce far more worktrees than anyone merges, so they can be sent to a
   * roomier drive. Absent falls through to `worktrees_base_dir`.
   */
  automation_worktrees_base_dir?: string;
  /**
   * App-level default LLM picked in Settings. Mirrored here from the renderer
   * so sessions created outside the UI (MCP, remote) resolve the same runner.
   */
  default_llm?: { model?: string | null; runner?: string | null };
  /** User-defined MCP servers merged into every spawned agent. */
  mcp_servers?: McpServers;
  /**
   * Auto-updater feed channel. `latest` is the public production feed; `beta`
   * subscribes to in-development builds cut from `main`. Defaults to `latest`.
   * Mirrored to/from the renderer settings store. Alpha builds (one-off
   * builds from any branch) are not subscribable here — they're installed
   * manually from the GitHub release page by repo collaborators.
   */
  updater_channel?: "beta" | "latest";
  /**
   * Headless server only: install a downloaded update and restart as soon as
   * no agent is running. Off by default — a mini restarting unprompted is a
   * surprise. Toggled from the server's tray menu.
   */
  server_auto_install_updates?: boolean;
  /**
   * Master kill-switch for the automation scheduler. When false no automation
   * fires on its clock; manual runs still work. Defaults to true — the
   * automations shipped with Argus are seeded disabled, so nothing runs until
   * you turn one on.
   */
  automations_enabled?: boolean;
  /**
   * Screen Argus opens on. `home` is the project picker; `inbox` is the
   * briefing. Defaults to `home` — the inbox only earns the launch slot once
   * automations are actually producing proposals.
   */
  launch_route?: "home" | "inbox";
  /**
   * App-wide cap on how far any automation may go. Unset or null means no
   * cap — the automation's own level stands. A repo can cap it lower, never
   * higher.
   */
  default_autonomy?: AutonomyLevel | null;
  /**
   * Ceiling on auto-started automation sessions running at once, across every
   * automation. Defaults to 3.
   */
  max_concurrent_automation_sessions?: number;
  /** Spend automations may reach in a day, in USD. 0 or unset = no budget. */
  automation_daily_budget_usd?: number;
  /**
   * Extra shell commands a read-only automation may run, on top of the
   * built-in reads. A bare command (`conductor`) or a prefix (`gh pr list`);
   * a prefix must match from the start of the command.
   *
   * Machine-local on purpose. A project cannot widen this — a repo granting
   * itself `curl` would be authorising itself.
   */
  automation_allowed_commands?: string[];
  /**
   * Extra tools a read-only automation may call, by exact name, e.g.
   * `mcp__argus__trigger_run`. Same reasoning as the commands list.
   */
  automation_allowed_tools?: string[];
  /**
   * Master kill-switch for phone remote access. When false (default) the local
   * gateway + tunnel stay down and pairing is refused.
   */
  remote_enabled?: boolean;
  /**
   * @deprecated Superseded by the per-provider `remote_*_enabled` flags. Still
   * read once to migrate installs that predate concurrent providers.
   */
  remote_provider?: "cloudflare" | "none" | "tailscale";
  /**
   * Run `tailscale funnel` alongside any other provider. Providers are
   * independent — a phone syncs every reachable address and picks the simplest.
   */
  remote_tailscale_enabled?: boolean;
  /** Run `cloudflared` alongside any other provider. */
  remote_cloudflare_enabled?: boolean;
  /**
   * Cloudflare tunnel mode: "quick" (ephemeral trycloudflare URL, no account)
   * or "token" (stable named tunnel via a connector token). Defaults to quick.
   */
  remote_tunnel_mode?: "quick" | "token";
  /** Cloudflare connector token for a named tunnel (token mode). */
  remote_tunnel_token?: string;
  /** Stable public URL for the named tunnel, configured in Cloudflare. */
  remote_public_url?: string;
  /**
   * Serve the web client on the LAN — binds the gateway to the network
   * interface so other devices on your Wi-Fi can open it in a browser. Access
   * is still gated by Noise pairing; this only changes reachability.
   */
  remote_lan_web?: boolean;
  /**
   * Mirror notifications to paired devices even while the Argus window is
   * focused. Off by default — otherwise your phone buzzes for every agent you
   * are already watching on screen.
   */
  remote_notify_when_focused?: boolean;
}

interface AppSettingsFile {
  version: number;
  settings: AppSettings;
}

function filePath(): string {
  return path.join(argusHomeDir(), "app-settings.json");
}

function readFile(): AppSettingsFile {
  const empty: AppSettingsFile = { version: SCHEMA_VERSION, settings: {} };

  let raw: string;
  try {
    raw = fs.readFileSync(filePath(), "utf8");
  } catch {
    return empty;
  }

  try {
    const parsed = JSON.parse(raw) as AppSettingsFile;
    if (parsed.version !== SCHEMA_VERSION || !parsed.settings) {
      return empty;
    }

    return parsed;
  } catch (e) {
    warn("Failed to parse app-settings.json:", e);

    return empty;
  }
}

function writeFile(file: AppSettingsFile): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

export function loadAppSettings(): AppSettings {
  return readFile().settings;
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  const file = readFile();
  file.settings = { ...file.settings, ...settings };
  writeFile(file);
  // The app-wide base dir feeds every project's resolved worktree root.
  invalidateWorktreeLocationCache();

  return file.settings;
}

/** App-level MCP servers, normalised to an empty object if absent. */
export function loadAppMcpServers(): McpServers {
  const servers = loadAppSettings().mcp_servers;
  if (!servers || typeof servers !== "object") {
    return {};
  }

  return servers;
}
