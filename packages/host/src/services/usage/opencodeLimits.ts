/**
 * OpenCode Go's session, weekly and monthly allowance, read with the Go API
 * key OpenCode saved or OPENCODE_API_KEY. Keys are read per check, never
 * stored or logged.
 */

import type { PlanReading } from "./planApis";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { opencodeGoWindows } from "./runnerWindows";

const FETCH_TIMEOUT_MS = 10_000;
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const CONSOLE_URL = "https://opencode.ai/console";

const unsupported = (message: string): PlanReading => ({
  status: "unsupported",
  plan: null,
  message,
  windows: [],
});

export function opencodeDataDir(env = process.env): string {
  const dataHome =
    env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");

  return path.join(dataHome, "opencode");
}

/** The Go key in `auth.json` (or OPENCODE_AUTH_CONTENT), else OPENCODE_API_KEY. */
export function opencodeAuthKey(
  authJson: string | null,
  env = process.env,
): string | null {
  try {
    const auth: unknown = JSON.parse(authJson ?? "{}");
    const go =
      typeof auth === "object" && auth !== null
        ? (auth as Record<string, unknown>)["opencode-go"]
        : undefined;
    if (typeof go === "object" && go !== null) {
      const { type, key } = go as { type?: unknown; key?: unknown };
      if (type === "api" && typeof key === "string" && key.trim()) {
        return key.trim();
      }
    }
  } catch {
    // Unreadable auth falls back to the environment.
  }

  return env.OPENCODE_API_KEY?.trim() || null;
}

/** A stored credential's key, unless it belongs to a self-hosted Console. */
export function opencodeStoredKey(value: unknown): string | null {
  try {
    const stored: unknown =
      typeof value === "string" ? JSON.parse(value) : null;
    if (typeof stored !== "object" || stored === null) {
      return null;
    }
    const { type, key, metadata } = stored as {
      type?: unknown;
      key?: unknown;
      metadata?: { server?: unknown } | null;
    };
    if (type !== "key" || typeof key !== "string" || !key.trim()) {
      return null;
    }
    const server = metadata?.server;
    if (typeof server === "string") {
      const url = new URL(server);
      if (`${url.origin}${url.pathname.replace(/\/+$/, "")}` !== CONSOLE_URL) {
        return null;
      }
    }

    return key.trim();
  } catch {
    return null;
  }
}

/** OpenCode 2 keeps credentials in its database, the Console's key under `opencode`. */
async function databaseKeys(dir: string, env = process.env): Promise<string[]> {
  const file = env.OPENCODE_DB?.trim() || "opencode.db";
  const dbPath = path.resolve(dir, file);
  if (file === ":memory:" || !fs.existsSync(dbPath)) {
    return [];
  }
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 100");
      const query = db.prepare(
        `SELECT value FROM credential
         WHERE integration_id = ? AND active IS NOT 0
         ORDER BY active DESC, time_created DESC, id DESC LIMIT 1`,
      );

      return ["opencode", "opencode-go"].flatMap((id) => {
        const key = opencodeStoredKey(query.get(id)?.value);

        return key ? [key] : [];
      });
    } finally {
      db.close();
    }
  } catch {
    // An older OpenCode (no credential table) or a Node without SQLite.
    return [];
  }
}

function readAuthFile(dir: string, env = process.env): string | null {
  if (env.OPENCODE_AUTH_CONTENT) {
    return env.OPENCODE_AUTH_CONTENT;
  }
  try {
    return fs.readFileSync(path.join(dir, "auth.json"), "utf8");
  } catch {
    return null;
  }
}

export async function readOpencodeLimits(
  now = Date.now(),
): Promise<PlanReading> {
  const dir = opencodeDataDir();
  const authJson = readAuthFile(dir);
  // Inline auth overrides everything OpenCode stored, the database included.
  const stored = process.env.OPENCODE_AUTH_CONTENT
    ? []
    : await databaseKeys(dir);
  const keys = [
    ...new Set([...stored, opencodeAuthKey(authJson)].filter(Boolean)),
  ] as string[];
  if (keys.length === 0) {
    return unsupported("Add an OpenCode Go API key to see plan limits.");
  }
  let res: Response | null = null;
  for (const key of keys) {
    res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status !== 401 && res.status !== 403) {
      break;
    }
  }
  if (!res) {
    throw new Error("no response");
  }
  // A valid Zen key needn't come with a Go subscription.
  if (res.status === 403) {
    return unsupported(
      "This OpenCode key has no Go subscription, which is what has plan limits.",
    );
  }
  if (res.status === 401) {
    return {
      status: "failed",
      plan: null,
      message:
        "OpenCode Go turned down the saved API key. Add a new one to see plan limits.",
      windows: [],
    };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const windows = opencodeGoWindows(await res.json(), now);
  if (windows.length === 0) {
    throw new Error("unexpected usage response");
  }

  return { status: "ok", plan: "Go", message: null, windows };
}
