/**
 * Plan limits per Claude account, read from the CLI itself: a stream-json
 * session that never gets a prompt answers the `get_usage` control request
 * with the account's own sign-in, so no API call is made and Argus never
 * handles the OAuth token.
 */

import type {
  ClaudeAccountLimits,
  ClaudeUsageLimits,
} from "@argus/remote-protocol";
import { spawn } from "node:child_process";
import os from "node:os";
import { warn } from "@argus/host/logger";
import {
  DEFAULT_ACCOUNT_ID,
  envForAccount,
  listClaudeAccounts,
  type ClaudeAccount,
} from "../claudeAuth/accounts";
import { capture } from "../telemetry/telemetry";
import { applyRateLimitEvent, windowsFromUsageResponse } from "./limitWindows";

const CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 20_000;

/** Gateway credentials outrank the account's sign-in; the probe is about the account. */
const GATEWAY_ENV = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
];

const cache = new Map<string, ClaudeAccountLimits>();
const inflight = new Map<string, Promise<ClaudeAccountLimits>>();

function labelFor(account: ClaudeAccount | undefined): string {
  return account?.label || account?.email || "Claude";
}

/** Run `get_usage` against one account and return the raw response. */
export function requestUsage(accountId: string): Promise<unknown> {
  const env = envForAccount(accountId);
  for (const key of GATEWAY_ENV) {
    Reflect.deleteProperty(env, key);
  }
  // Keep the probe from starting anything: no hooks, no MCP, no IDE.
  Object.assign(env, {
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
  });
  const child = spawn(
    "claude",
    [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--settings",
      JSON.stringify({ disableAllHooks: true }),
    ],
    { cwd: os.tmpdir(), env, stdio: ["pipe", "pipe", "ignore"] },
  );

  return new Promise((resolve, reject) => {
    let buffer = "";
    const done = (err: Error | null, value?: unknown) => {
      clearTimeout(timer);
      child.kill();
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () => done(new Error("usage probe timed out")),
      PROBE_TIMEOUT_MS,
    );
    child.on("error", (e) => done(e));
    child.on("exit", () => done(new Error("usage probe exited early")));
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let msg: {
          type?: string;
          response?: {
            request_id?: string;
            subtype?: string;
            response?: unknown;
            error?: string;
          };
        };
        try {
          msg = JSON.parse(line) as typeof msg;
        } catch {
          continue;
        }
        if (
          msg.type !== "control_response" ||
          msg.response?.request_id !== "usage"
        ) {
          continue;
        }
        if (msg.response.subtype === "success") {
          done(null, msg.response.response);
        } else {
          done(new Error(msg.response.error ?? "usage request failed"));
        }
      }
    });
    child.stdin.on("error", () => undefined);
    for (const request of [
      { request_id: "init", request: { subtype: "initialize" } },
      {
        request_id: "usage",
        request: { subtype: "get_usage", skip_behaviors: true },
      },
    ]) {
      child.stdin.write(
        `${JSON.stringify({ type: "control_request", ...request })}\n`,
      );
    }
  });
}

async function probe(
  account: ClaudeAccount | undefined,
  id: string,
): Promise<ClaudeAccountLimits> {
  const base = {
    account_id: id,
    label: labelFor(account),
    subscription_type: account?.subscription_type ?? null,
  };
  if (account?.account_type === "console") {
    return {
      ...base,
      status: "unsupported",
      windows: [],
      checked_at: Date.now(),
    };
  }
  try {
    const now = Date.now();
    const parsed = windowsFromUsageResponse(await requestUsage(id), now);
    const result: ClaudeAccountLimits = {
      ...base,
      subscription_type: parsed.subscriptionType ?? base.subscription_type,
      status: parsed.available ? "ok" : "unsupported",
      windows: parsed.windows,
      checked_at: now,
    };
    capture("usage_limits_fetched", {
      outcome: result.status,
      window_count: result.windows.length,
    });

    return result;
  } catch (e) {
    warn(`[usage] limits probe failed for account ${id}: ${String(e)}`);
    capture("usage_limits_fetched", { outcome: "failed", window_count: 0 });
    // A failed probe keeps the last good numbers on screen.
    const last = cache.get(id);

    return last
      ? { ...last, status: "failed" }
      : { ...base, status: "failed", windows: [], checked_at: Date.now() };
  }
}

function limitsFor(
  account: ClaudeAccount | undefined,
  id: string,
  refresh: boolean,
) {
  const cached = cache.get(id);
  if (!refresh && cached && Date.now() - cached.checked_at < CACHE_MS) {
    return Promise.resolve(cached);
  }
  const running = inflight.get(id);
  if (running) {
    return running;
  }
  const next = probe(account, id)
    .then((result) => {
      cache.set(id, result);

      return result;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, next);

  return next;
}

export async function getClaudeUsageLimits(
  refresh = false,
): Promise<ClaudeUsageLimits> {
  const accounts = listClaudeAccounts();
  const targets: [ClaudeAccount | undefined, string][] =
    accounts.length > 0
      ? accounts.map((a) => [a, a.id])
      : [[undefined, DEFAULT_ACCOUNT_ID]];

  return {
    accounts: await Promise.all(
      targets.map(([a, id]) => limitsFor(a, id, refresh)),
    ),
  };
}

/** A running agent's stream reports fresher numbers than the last probe. */
export function noteUsageRateLimitLine(accountId: string, line: string): void {
  if (!line.includes("rate_limit_event")) {
    return;
  }
  const cached = cache.get(accountId);
  if (!cached) {
    return;
  }
  const windows = applyRateLimitEvent(cached.windows, line, Date.now());
  if (windows) {
    cache.set(accountId, { ...cached, windows });
  }
}

/** One account's plan limits through the same cache and probe as the usage view. */
export function getAccountLimits(id: string): Promise<ClaudeAccountLimits> {
  return limitsFor(
    listClaudeAccounts().find((a) => a.id === id),
    id,
    false,
  );
}
