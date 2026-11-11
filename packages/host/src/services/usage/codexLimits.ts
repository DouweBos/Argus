/**
 * Codex plan windows from the CLI itself: a throwaway `codex app-server` is
 * asked for the account and its rate limits with the user's own sign-in, so
 * Argus never handles the token.
 */

import type { PlanReading } from "./planApis";
import { spawn } from "node:child_process";
import os from "node:os";
import { JsonRpcPeer } from "../llm/runners/rpc";
import { latestCodexRateLimits } from "./codexLiveLimits";
import { codexWindows } from "./runnerWindows";

const PROBE_TIMEOUT_MS = 20_000;

interface CodexAccount {
  account?: { type?: string; planType?: string } | null;
}

async function ask(): Promise<{ account: CodexAccount; limits: unknown }> {
  const child = spawn("codex", ["app-server"], {
    cwd: os.tmpdir(),
    stdio: ["pipe", "pipe", "ignore"],
    env: { ...process.env, RUST_LOG: "error" },
  });
  const rpc = new JsonRpcPeer(child.stdin, child.stdout, {
    notification: () => undefined,
    request: (r) => rpc.respondError(r.id, "not supported"),
    malformed: () => undefined,
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Codex didn't answer in time")),
      PROBE_TIMEOUT_MS,
    );
  });
  const exited = new Promise<never>((_, reject) => {
    child.on("error", reject);
    child.on("exit", () => reject(new Error("Codex exited early")));
  });
  child.stdin.on("error", () => undefined);
  try {
    const run = async () => {
      await rpc.request("initialize", {
        clientInfo: { name: "argus", title: "Argus", version: "usage" },
        capabilities: { experimentalApi: false },
      });
      rpc.notify("initialized");
      const account = await rpc.request<CodexAccount>("account/read", {
        refreshToken: false,
      });
      if (account.account?.type !== "chatgpt") {
        return { account, limits: null };
      }

      return {
        account,
        limits: await rpc.request<unknown>(
          "account/rateLimits/read",
          undefined,
        ),
      };
    };

    return await Promise.race([run(), timeout, exited]);
  } finally {
    clearTimeout(timer);
    rpc.close("usage probe finished");
    child.kill();
  }
}

export async function readCodexLimits(now = Date.now()): Promise<PlanReading> {
  const { account, limits } = await ask();
  const kind = account.account?.type;
  if (!kind) {
    return {
      status: "unsupported",
      plan: null,
      message: "Run `codex login` to see plan limits.",
      windows: [],
    };
  }
  if (kind !== "chatgpt") {
    return {
      status: "unsupported",
      plan: null,
      message: "Signed in with an API key, which has no plan limits.",
      windows: [],
    };
  }
  const parsed = codexWindows(limits, now);

  return {
    status: "ok",
    plan: parsed.plan ?? account.account?.planType ?? null,
    message: null,
    windows: parsed.windows,
  };
}

/** A running agent's push when it is newer than the reading. */
export function applyLiveCodexLimits(
  cached: PlanReading,
  checkedAt: number,
  now = Date.now(),
): PlanReading {
  const live = latestCodexRateLimits();
  if (!live || live.at <= checkedAt || cached.status !== "ok") {
    return cached;
  }
  const parsed = codexWindows(live.raw, now);

  return parsed.windows.length > 0
    ? { ...cached, windows: parsed.windows, plan: parsed.plan ?? cached.plan }
    : cached;
}
