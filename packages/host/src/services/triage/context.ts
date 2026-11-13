/**
 * What a triage agent gets to look at: the version, the machine, the settings
 * that shape behaviour (never secrets, paths or names) and the host's logs.
 */

import type { AppSettings } from "../appSettings/store";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";
import { hostPlatform } from "../../platform";
import { loadAppSettings } from "../appSettings/store";

export const TRIAGE_REPO = "DouweBos/Argus";

/** The tail of each log copied into the pad, so the agent never reads outside it. */
const SNAPSHOT_BYTES = 256 * 1024;

export interface TriageProblem {
  message?: string | null;
  level?: "error" | "warning" | null;
  source?: string | null;
}

/** Allowlisted, so a setting added later never leaks by default. */
const SAFE_SETTINGS = [
  "updater_channel",
  "automations_enabled",
  "warm_agents",
  "default_permission_mode",
  "default_autonomy",
  "remote_enabled",
  "remote_provider",
  "remote_tailscale_enabled",
  "remote_cloudflare_enabled",
  "remote_tunnel_mode",
  "remote_lan_web_client",
  "save_chat_history",
  "telemetry_mode",
] as const satisfies readonly (keyof AppSettings)[];

export function safeSettings(
  settings: AppSettings,
): Record<string, boolean | number | string> {
  const out: Record<string, boolean | number | string> = {};
  for (const key of SAFE_SETTINGS) {
    const value = settings[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  if (settings.default_llm?.runner) {
    out.default_runner = settings.default_llm.runner;
  }
  out.remote_tunnel_token_set = Boolean(settings.remote_tunnel_token);
  out.remote_public_url_set = Boolean(settings.remote_public_url);
  out.mcp_server_count = Object.keys(settings.mcp_servers ?? {}).length;

  return out;
}

export function buildCommit(): string | null {
  return process.env.ARGUS_COMMIT?.trim() || null;
}

/** Every host log on disk, newest first. */
export function hostLogFiles(): string[] {
  const dir = path.join(argusHomeDir(), "logs");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  return names
    .filter((n) => /\.log(\.\d+)?$/.test(n))
    .map((n) => path.join(dir, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/** Copy the current logs' tails into `<padDir>/logs`. */
export function snapshotLogs(padDir: string, files: string[]): string[] {
  const out = path.join(padDir, "logs");
  fs.mkdirSync(out, { recursive: true });
  const copied: string[] = [];
  for (const file of files.filter((f) => f.endsWith(".log"))) {
    try {
      const size = fs.statSync(file).size;
      const start = Math.max(0, size - SNAPSHOT_BYTES);
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      const dest = path.join(out, path.basename(file));
      fs.writeFileSync(dest, buf);
      copied.push(path.relative(padDir, dest));
    } catch {
      // A log that vanished mid-rotation is not worth failing triage over.
    }
  }

  return copied;
}

/** `TRIAGE.md`: everything the playbook tells the agent to start from. */
export function triageBrief(
  problem: TriageProblem,
  logs: { files: string[]; snapshots: string[] },
): string {
  const version = hostPlatform().appVersion();
  const commit = buildCommit();
  const ref = commit ?? `v${version}`;
  const settings = safeSettings(loadAppSettings());
  const lines = [
    "# Triage brief",
    "",
    "## Problem",
    "",
    problem.message?.trim()
      ? "```\n" + problem.message.trim() + "\n```"
      : "Not given — ask the user what went wrong, then look for it in the logs.",
    ...(problem.level ? [`- Level: ${problem.level}`] : []),
    ...(problem.source ? [`- Source: ${problem.source}`] : []),
    `- Reported: ${new Date().toISOString()}`,
    "",
    "## Environment",
    "",
    `- Argus version: ${version}`,
    `- Commit: ${commit ?? "unknown (use the version tag)"}`,
    `- Host: ${hostPlatform().name}`,
    `- OS: ${os.type()} ${os.release()} (${process.arch})`,
    `- Node: ${process.version}`,
    `- Source at this build: https://github.com/${TRIAGE_REPO}/tree/${ref}`,
    "",
    "## Settings (secrets, paths and names removed)",
    "",
    ...Object.entries(settings).map(([k, v]) => `- ${k}: ${String(v)}`),
    "",
    "## Logs",
    "",
    "Snapshots (the last 256 KB of each current log) in this directory:",
    ...logs.snapshots.map((f) => `- ${f}`),
    "",
    "Full logs on this machine, newest first:",
    ...logs.files.map((f) => `- ${f}`),
    "",
  ];

  return lines.join("\n");
}
