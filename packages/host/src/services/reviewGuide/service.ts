/**
 * Review guides: a read-only one-shot agent writes an ordered tour of a
 * session's or pull request's diff. Written in the background (minutes, not
 * a request's seconds), cached on disk per head so reopening is instant.
 */

import type {
  RemoteReviewGuide,
  RemoteReviewGuideState,
} from "@argus/remote-protocol";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { runClaudePrint } from "../llm/oneShot";
import { capture } from "../telemetry/telemetry";
import {
  ASK_SYSTEM_PROMPT,
  GUIDE_SYSTEM_PROMPT,
  askPrompt,
  guidePrompt,
  normalizeGuide,
  parsePatch,
} from "./guide";
import {
  type GuideTarget,
  guidesDir,
  resolveTarget,
  sessionHead,
  targetKey,
} from "./target";

const GENERATE_TIMEOUT_MS = 10 * 60_000;
const ASK_TIMEOUT_MS = 3 * 60_000;
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];
/** Guides kept per target, newest first: enough to step back after a push. */
const KEEP = 5;

interface CacheEntry {
  guide: RemoteReviewGuide;
  patch: string;
  cwd: string;
}

interface Job {
  startedAt: string;
  error: string | null;
  running: boolean;
}

const jobs = new Map<string, Job>();

function cacheFile(key: string): string {
  return path.join(
    guidesDir(),
    `${createHash("sha1").update(key).digest("hex")}.json`,
  );
}

function readCache(key: string): CacheEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(key), "utf8")) as {
      entries?: CacheEntry[];
    };

    return parsed.entries ?? [];
  } catch {
    return [];
  }
}

function writeCache(key: string, entry: CacheEntry): void {
  const entries = [
    entry,
    ...readCache(key).filter((e) => e.guide.head_sha !== entry.guide.head_sha),
  ];
  fs.mkdirSync(guidesDir(), { recursive: true });
  fs.writeFileSync(
    cacheFile(key),
    JSON.stringify({ entries: entries.slice(0, KEEP) }),
  );
}

/** The head a client should see a guide for; null when it can't be known without a fetch. */
async function currentHead(
  target: GuideTarget,
  hint?: string,
): Promise<string | null> {
  if (target.kind === "pull_request") {
    return hint ?? null;
  }

  return sessionHead(target.sessionId).catch(() => null);
}

export async function getReviewGuide(
  target: GuideTarget,
  headHint?: string,
): Promise<RemoteReviewGuideState> {
  const key = targetKey(target);
  const head = await currentHead(target, headHint);
  const entries = readCache(key);
  // A PR's hint is the commit sha; a cached guide for it matches exactly.
  const entry =
    (head && entries.find((e) => e.guide.head_sha === head)) || entries[0];
  const job = jobs.get(key);
  const status = job?.running
    ? "generating"
    : entry
      ? "ready"
      : job?.error
        ? "failed"
        : "none";

  return {
    status,
    guide: entry?.guide ?? null,
    stale: Boolean(entry && head && entry.guide.head_sha !== head),
    error: job?.running ? null : (job?.error ?? null),
    started_at: job?.running ? job.startedAt : null,
    patch: entry?.patch ?? null,
  };
}

function bucket(n: number): "0" | "1-5" | "6-20" | "21-100" | "100+" {
  return n === 0
    ? "0"
    : n <= 5
      ? "1-5"
      : n <= 20
        ? "6-20"
        : n <= 100
          ? "21-100"
          : "100+";
}

function durationBucket(ms: number): "<1m" | "<3m" | "<10m" | ">=10m" {
  return ms < 60_000
    ? "<1m"
    : ms < 180_000
      ? "<3m"
      : ms < 600_000
        ? "<10m"
        : ">=10m";
}

type Failure = "claude" | "empty" | "none" | "resolve" | "unreadable";

async function write(
  target: GuideTarget,
  key: string,
  job: Job,
): Promise<void> {
  const started = Date.now();
  let failure: Failure = "none";
  let files = 0;
  let stops = 0;
  try {
    const resolved = await resolveTarget(target).catch((e: unknown) => {
      failure = "resolve";
      throw e;
    });
    const parsed = parsePatch(resolved.patch);
    files = parsed.length;
    if (files === 0) {
      failure = "empty";
      throw "There are no changes to guide you through.";
    }
    const reply = await runClaudePrint({
      prompt: guidePrompt(parsed, resolved),
      systemPrompt: GUIDE_SYSTEM_PROMPT,
      source: "review-guide",
      cwd: resolved.cwd,
      model: "sonnet",
      tools: READ_ONLY_TOOLS,
      timeoutMs: GENERATE_TIMEOUT_MS,
      quiet: true,
    });
    if (!reply) {
      failure = "claude";
      throw "Claude couldn't write the guide. Check that `claude` is signed in, then try again.";
    }
    const guide = normalizeGuide(reply, parsed, {
      headSha: resolved.headSha,
      baseRef: resolved.baseRef,
    });
    if (!guide) {
      failure = "unreadable";
      throw "Claude's guide couldn't be read. Try again.";
    }
    stops = guide.stops.length;
    writeCache(key, { guide, patch: resolved.patch, cwd: resolved.cwd });
    job.error = null;
  } catch (e) {
    job.error =
      typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
    warn(`[review-guide] ${key}: ${job.error}`);
  } finally {
    job.running = false;
    capture("review_guide_generated", {
      source: target.kind,
      success: failure === "none",
      failure,
      files_bucket: bucket(files),
      stops_bucket: bucket(stops),
      duration_bucket: durationBucket(Date.now() - started),
    });
  }
}

/** Starts a guide unless one is being written, or one exists for this head and `force` is off. */
export async function generateReviewGuide(
  target: GuideTarget,
  options: { force?: boolean; headHint?: string } = {},
): Promise<RemoteReviewGuideState> {
  const key = targetKey(target);
  const current = await getReviewGuide(target, options.headHint);
  if (
    current.status === "generating" ||
    (current.guide && !current.stale && !options.force)
  ) {
    return current;
  }
  const job: Job = {
    startedAt: new Date().toISOString(),
    error: null,
    running: true,
  };
  jobs.set(key, job);
  write(target, key, job).catch((e: unknown) =>
    warn(`[review-guide] ${key}:`, e),
  );

  return getReviewGuide(target, options.headHint);
}

/** A read-only answer to a question about one stop, from the guide's checkout. */
export async function askAboutStop(
  target: GuideTarget,
  stopId: string,
  question: string,
  headHint?: string,
): Promise<string> {
  const key = targetKey(target);
  const head = await currentHead(target, headHint);
  const entries = readCache(key);
  const entry =
    (head && entries.find((e) => e.guide.head_sha === head)) || entries[0];
  const stop = entry?.guide.stops.find((s) => s.id === stopId);
  if (!entry || !stop) {
    throw "That stop isn't in the guide any more. Reload it and try again.";
  }
  const answer = await runClaudePrint({
    prompt: askPrompt(entry.guide, stop, parsePatch(entry.patch), question),
    systemPrompt: ASK_SYSTEM_PROMPT,
    source: "review-guide-ask",
    cwd: fs.existsSync(entry.cwd) ? entry.cwd : undefined,
    model: "sonnet",
    tools: READ_ONLY_TOOLS,
    timeoutMs: ASK_TIMEOUT_MS,
    quiet: true,
  });
  capture("review_guide_asked", {
    source: target.kind,
    success: Boolean(answer),
  });
  if (!answer) {
    throw "Claude couldn't answer that. Check that `claude` is signed in, then try again.";
  }

  return answer.trim();
}

/** The wire's flat target as a `GuideTarget`. */
export function guideTarget(params: {
  session_id?: string;
  repo?: string;
  number?: number;
}): GuideTarget {
  if (params.session_id) {
    return { kind: "session", sessionId: params.session_id };
  }
  if (params.repo && params.number) {
    if (!/^[\w.-]+(\/[\w.-]+)+$/.test(params.repo)) {
      throw `Not an owner/repo slug: ${params.repo}`;
    }

    return { kind: "pull_request", repo: params.repo, number: params.number };
  }
  throw "A review guide needs a session_id, or a repo and number.";
}
