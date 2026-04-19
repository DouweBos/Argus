/**
 * Claude Code usage snapshot.
 *
 * Reads the live JSON payload that Claude Code pipes into the configured
 * `statusLine` command, captured to disk by our statusline tap (see
 * `statuslineHook.ts`). This is the same data source Claude Code's native
 * statusline uses — `rate_limits.five_hour`, `rate_limits.seven_day`,
 * `context_window.used_percentage`, etc.
 *
 * We do *not* parse session JSONL logs, and we do *not* call the undocumented
 * OAuth usage endpoint (Anthropic has started blocking third-party clients
 * and it's ToS-risky). The tradeoff: this file only updates while the user
 * has an interactive Claude Code session running in a terminal.
 */

import fs from "node:fs";
import { isHookInstalled, statusFilePath } from "./statuslineHook";

export interface ClaudeRateWindow {
  resets_at: number | string | null;
  used_percentage: number | null;
}

export interface ClaudeStatuslinePayload {
  context_window?: { used_percentage?: number | null };
  cost?: {
    total_cost_usd?: number | null;
    total_duration_ms?: number | null;
  };
  model?: { display_name?: string | null };
  rate_limits?: {
    five_hour?: ClaudeRateWindow;
    seven_day?: ClaudeRateWindow;
    seven_day_opus?: ClaudeRateWindow;
  };
  workspace?: { current_dir?: string | null };
}

export interface ClaudeUsage {
  computed_at: number;
  file_mtime_ms: number | null;
  hook_installed: boolean;
  hook_script_path: string;
  payload: ClaudeStatuslinePayload | null;
}

export function getClaudeUsage(): ClaudeUsage {
  const now = Date.now();
  const file = statusFilePath();
  let payload: ClaudeStatuslinePayload | null = null;
  let mtime: number | null = null;

  try {
    const stat = fs.statSync(file);
    mtime = stat.mtimeMs;
    const raw = fs.readFileSync(file, "utf8");
    payload = JSON.parse(raw) as ClaudeStatuslinePayload;
  } catch {
    // File absent or unreadable — caller surfaces the "install hook" prompt.
  }

  return {
    computed_at: now,
    file_mtime_ms: mtime,
    hook_installed: isHookInstalled(),
    hook_script_path: file,
    payload,
  };
}
