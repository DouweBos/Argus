/**
 * Plan limits for every installed runner that has them, next to Claude's:
 * Codex rate limits, Cursor's monthly pools, Grok's subscription period,
 * OpenCode Go's allowance and Antigravity's quotas.
 * Each is checked at most once a minute unless asked to refresh.
 */

import type {
  ClaudeUsageLimits,
  RunnerUsageLimits,
} from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import { getRunnerById, runnerAvailability } from "../llm/registry";
import { capture } from "../telemetry/telemetry";
import { readAntigravityLimits } from "./antigravityLimits";
import { applyLiveCodexLimits, readCodexLimits } from "./codexLimits";
import { CODEX_RUNNER_ID } from "./codexRollouts";
import { getClaudeUsageLimits } from "./limits";
import { readOpencodeLimits } from "./opencodeLimits";
import { readCursorLimits, readGrokLimits, type PlanReading } from "./planApis";

const CACHE_MS = 60_000;

type PlanRunner = "antigravity" | "codex" | "cursor" | "grok" | "opencode";

const READERS: Record<PlanRunner, (now: number) => Promise<PlanReading>> = {
  [CODEX_RUNNER_ID]: readCodexLimits,
  cursor: readCursorLimits,
  grok: readGrokLimits,
  opencode: readOpencodeLimits,
  antigravity: readAntigravityLimits,
};

const cache = new Map<PlanRunner, RunnerUsageLimits>();
const inflight = new Map<PlanRunner, Promise<RunnerUsageLimits>>();

async function check(runner: PlanRunner): Promise<RunnerUsageLimits> {
  const now = Date.now();
  const base = {
    runner,
    label: getRunnerById(runner)?.displayName ?? runner,
    checked_at: now,
  };
  try {
    const reading = await READERS[runner](now);
    capture("runner_usage_limits_fetched", {
      runner,
      outcome: reading.status,
      window_count: reading.windows.length,
    });

    return { ...base, ...reading };
  } catch (e) {
    warn(`[usage] ${runner} limits check failed: ${String(e)}`);
    capture("runner_usage_limits_fetched", {
      runner,
      outcome: "failed",
      window_count: 0,
    });
    // A failed check keeps the last good numbers on screen.
    const last = cache.get(runner);

    return last
      ? { ...last, status: "failed" }
      : {
          ...base,
          status: "failed",
          plan: null,
          message: `Couldn't read ${base.label}'s plan limits.`,
          windows: [],
        };
  }
}

function limitsFor(
  runner: PlanRunner,
  refresh: boolean,
): Promise<RunnerUsageLimits> {
  const cached = cache.get(runner);
  if (!refresh && cached && Date.now() - cached.checked_at < CACHE_MS) {
    return Promise.resolve(
      runner === CODEX_RUNNER_ID
        ? { ...cached, ...applyLiveCodexLimits(cached, cached.checked_at) }
        : cached,
    );
  }
  const running = inflight.get(runner);
  if (running) {
    return running;
  }
  const next = check(runner)
    .then((result) => {
      cache.set(runner, result);

      return result;
    })
    .finally(() => inflight.delete(runner));
  inflight.set(runner, next);

  return next;
}

/** Installed runners with plan limits, in a fixed order. */
export async function getRunnerUsageLimits(
  refresh = false,
): Promise<RunnerUsageLimits[]> {
  const available = await runnerAvailability();
  const runners = (Object.keys(READERS) as PlanRunner[]).filter(
    (id) => available.get(id)?.available,
  );

  return Promise.all(runners.map((id) => limitsFor(id, refresh)));
}

/** Claude accounts and the other runners together, as the Usage screen shows them. */
export async function getUsageLimits(
  refresh = false,
): Promise<ClaudeUsageLimits> {
  const [claude, runners] = await Promise.all([
    getClaudeUsageLimits(refresh),
    getRunnerUsageLimits(refresh),
  ]);

  return { ...claude, runners };
}
