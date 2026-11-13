/**
 * Antigravity's plan quotas from Google's Cloud Code service, with the sign-in
 * `agy` saved. Tokens are read and refreshed per check, never stored or logged.
 */

import type { PlanReading } from "./planApis";
import type { UsageLimitWindow } from "@argus/remote-protocol";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  antigravityModelWindows,
  antigravitySummaryWindows,
} from "./antigravityWindows";

const FETCH_TIMEOUT_MS = 10_000;
const DAILY_API = "https://daily-cloudcode-pa.googleapis.com";
const PROD_API = "https://cloudcode-pa.googleapis.com";
const LOGIN_HINT = "Run `agy acp --login` to see plan limits.";

interface AcpToken {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  project_id?: string;
}

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

/** `agy` keeps its ACP sign-in under GEMINI_HOME, `~/.gemini` by default. */
export function antigravityAcpDir(env = process.env): string {
  const home = env.GEMINI_HOME?.trim() || path.join(os.homedir(), ".gemini");

  return path.join(home, "antigravity-acp");
}

function readToken(dir: string): AcpToken | null {
  const raw = readJson(path.join(dir, "acp_token.json"));
  const field = (key: string) =>
    typeof raw?.[key] === "string" ? raw[key].trim() : "";
  const token = {
    client_id: field("client_id"),
    client_secret: field("client_secret"),
    refresh_token: field("refresh_token"),
  };
  if (!token.client_id || !token.client_secret || !token.refresh_token) {
    return null;
  }
  const project = field("project_id");

  return project ? { ...token, project_id: project } : token;
}

async function accessToken(token: AcpToken): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: token.client_id,
      client_secret: token.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 400 || res.status === 401) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`token refresh HTTP ${res.status}`);
  }
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("no access token");
  }

  return body.access_token;
}

/** Each endpoint's windows, or null when it didn't answer. */
async function ask(
  operation: string,
  endpoints: string[],
  token: string,
  project: string | undefined,
  parse: (raw: unknown, requestedAt: number) => UsageLimitWindow[],
): Promise<(UsageLimitWindow[] | null)[]> {
  return Promise.all(
    endpoints.map(async (endpoint) => {
      const requestedAt = Date.now();
      try {
        const res = await fetch(`${endpoint}/v1internal:${operation}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            // The service only answers its own clients.
            "User-Agent": `antigravity/hub/2.24.0 (aidev_client; os_type=${process.platform}; arch=${process.arch}; cl=963137146)`,
          },
          body: JSON.stringify(project ? { project } : {}),
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        return res.ok ? parse(await res.json(), requestedAt) : null;
      } catch {
        return null;
      }
    }),
  );
}

/** The first endpoint's reading of a window wins; the others add the groups it lacks. */
function merge(readings: (UsageLimitWindow[] | null)[]): UsageLimitWindow[] {
  const windows = new Map<string, UsageLimitWindow>();
  for (const w of readings.flatMap((r) => r ?? [])) {
    if (!windows.has(w.id)) {
      windows.set(w.id, w);
    }
  }

  return [...windows.values()];
}

export async function readAntigravityLimits(
  now = Date.now(),
): Promise<PlanReading> {
  const dir = antigravityAcpDir();
  const settings = readJson(path.join(dir, "settings.json"));
  const auth = settings?.auth as { type?: unknown } | undefined;
  const method = typeof auth?.type === "string" ? auth.type : "oauth-personal";
  if (method !== "oauth-personal" && method !== "oauth-business") {
    return {
      status: "unsupported",
      plan: null,
      message: "Antigravity runs on an API key, which has no plan limits.",
      windows: [],
    };
  }
  const token = readToken(dir);
  if (!token) {
    return {
      status: "unsupported",
      plan: null,
      message: LOGIN_HINT,
      windows: [],
    };
  }
  const access = await accessToken(token);
  if (!access) {
    return {
      status: "failed",
      plan: null,
      message:
        "Antigravity's sign-in has expired. Run `agy acp --login` to renew it.",
      windows: [],
    };
  }
  // Consumer tiers are metered on the daily host, Workspace and Cloud tiers on prod.
  const endpoints =
    method === "oauth-business" ? [PROD_API, DAILY_API] : [DAILY_API, PROD_API];
  const summary = await ask(
    "retrieveUserQuotaSummary",
    endpoints,
    access,
    token.project_id,
    (raw, at) => antigravitySummaryWindows(raw, at, now),
  );
  let windows = merge(summary);
  let answered = summary.some((r) => r !== null);
  if (windows.length === 0) {
    const models = await ask(
      "fetchAvailableModels",
      endpoints,
      access,
      token.project_id,
      (raw) => antigravityModelWindows(raw, now),
    );
    windows = merge(models);
    answered ||= models.some((r) => r !== null);
  }
  if (!answered) {
    throw new Error("no quota endpoint answered");
  }

  return windows.length > 0
    ? { status: "ok", plan: null, message: null, windows }
    : {
        status: "unsupported",
        plan: null,
        message: "This Antigravity plan reports no usage allowance.",
        windows: [],
      };
}
