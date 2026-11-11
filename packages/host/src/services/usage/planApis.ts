/**
 * Cursor and Grok plan allowances from their own services, with the sign-in
 * their CLIs saved. Tokens are read per check, never stored or logged.
 */

import type { UsageLimitWindow } from "@argus/remote-protocol";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { cursorWindows, grokWindows } from "./runnerWindows";

const execFileAsync = promisify(execFile);
const FETCH_TIMEOUT_MS = 10_000;

/** One runner's plan as read, before it gets its runner id and label. */
export interface PlanReading {
  status: "failed" | "ok" | "unsupported";
  plan: string | null;
  message: string | null;
  windows: UsageLimitWindow[];
}

const unsupported = (message: string): PlanReading => ({
  status: "unsupported",
  plan: null,
  message,
  windows: [],
});

const failed = (message: string): PlanReading => ({
  status: "failed",
  plan: null,
  message,
  windows: [],
});

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

const CURSOR_API = "https://api2.cursor.sh";

/** Where `cursor-agent login` keeps its access token: the Keychain on macOS, a file elsewhere. */
async function cursorLoginToken(): Promise<string | null> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "security",
        [
          "find-generic-password",
          "-s",
          "cursor-access-token",
          "-a",
          "cursor-user",
          "-w",
        ],
        { timeout: FETCH_TIMEOUT_MS },
      );
      const token = stdout.trim();
      if (token) {
        return token;
      }
    } catch {
      // Not signed in through the Keychain; try the file.
    }
  }
  const config =
    process.platform === "darwin"
      ? path.join(os.homedir(), ".cursor")
      : path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
          "cursor",
        );
  const token = readJson(path.join(config, "auth.json"))?.accessToken;

  return typeof token === "string" && token.trim() ? token.trim() : null;
}

/** An API key is traded for the access token Cursor's RPCs accept. */
async function exchangeCursorApiKey(apiKey: string): Promise<string> {
  const res = await fetch(`${CURSOR_API}/auth/exchange_user_api_key`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as { accessToken?: unknown };
  if (typeof body.accessToken !== "string" || !body.accessToken) {
    throw new Error("no access token");
  }

  return body.accessToken;
}

export async function readCursorLimits(now = Date.now()): Promise<PlanReading> {
  let token = process.env.CURSOR_AUTH_TOKEN?.trim() || null;
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!token && apiKey) {
    token = await exchangeCursorApiKey(apiKey);
  }
  token ??= await cursorLoginToken();
  if (!token) {
    return unsupported("Run `cursor-agent login` to see plan limits.");
  }
  const res = await fetch(
    `${CURSOR_API}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "connect-protocol-version": "1",
        "x-cursor-client-type": "cli",
      },
      body: "{}",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (res.status === 401 || res.status === 403) {
    return failed(
      "Cursor's sign-in has expired. Run `cursor-agent` to renew it.",
    );
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const windows = cursorWindows(await res.json(), now);

  return windows.length > 0
    ? { status: "ok", plan: null, message: null, windows }
    : unsupported("This Cursor plan reports no usage allowance.");
}

// ---------------------------------------------------------------------------
// Grok
// ---------------------------------------------------------------------------

const GROK_BILLING_URL =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
/** The sign-in entries `grok login` writes; other keys belong to custom deployments. */
const GROK_CREDENTIAL_KEYS = [
  "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828",
  "https://accounts.x.ai/sign-in",
];

function grokHome(): string {
  return process.env.GROK_HOME?.trim() || path.join(os.homedir(), ".grok");
}

function grokLoginToken(): string | null {
  const auth = readJson(path.join(grokHome(), "auth.json"));
  for (const key of GROK_CREDENTIAL_KEYS) {
    const entry = auth?.[key] as
      | { key?: unknown; auth_mode?: unknown }
      | undefined;
    if (
      entry &&
      entry.auth_mode !== "api_key" &&
      typeof entry.key === "string"
    ) {
      return entry.key.trim() || null;
    }
  }

  return null;
}

export async function readGrokLimits(now = Date.now()): Promise<PlanReading> {
  if (process.env.XAI_API_KEY?.trim()) {
    return unsupported("Grok runs on an API key, which has no plan limits.");
  }
  const token = grokLoginToken();
  if (!token) {
    return unsupported("Run `grok login` to see plan limits.");
  }
  const res = await fetch(GROK_BILLING_URL, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 401) {
    return failed("Grok's sign-in has expired. Run `grok login` to renew it.");
  }
  if (res.status === 403) {
    const body = await res.text();
    if (body.includes("privacy-mode")) {
      return failed(
        "Switch your xAI account to Privacy Mode to see Grok plan limits.",
      );
    }
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const windows = grokWindows(await res.json(), now);

  return windows.length > 0
    ? { status: "ok", plan: null, message: null, windows }
    : unsupported("This Grok plan reports no usage allowance.");
}
