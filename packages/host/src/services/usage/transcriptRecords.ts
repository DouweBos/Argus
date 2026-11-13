/**
 * Token usage records from Claude Code session transcripts
 * (`~/.claude/projects/**.jsonl`), read incrementally per file.
 */

import type { UsageSpeed } from "@argus/remote-protocol";
import os from "node:os";
import path from "node:path";
import { JsonlScanner, listJsonl } from "./jsonlScan";
import { CLAUDE_RUNNER_ID, tokenCount, type UsageRecord } from "./records";

export type { UsageRecord } from "./records";

/** Fast mode is recorded on the message's usage; anything else billed as standard. */
function speedOf(v: unknown): { speed?: UsageSpeed } {
  return v === "fast" || v === "ultrafast" ? { speed: v } : {};
}

export function parseUsageLine(line: string): UsageRecord | null {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) {
    return null;
  }
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    rec.type !== "assistant" ||
    typeof rec.message !== "object" ||
    rec.message === null
  ) {
    return null;
  }
  const message = rec.message as Record<string, unknown>;
  const usage = message.usage as Record<string, unknown> | undefined;
  const at =
    typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
  const model = typeof message.model === "string" ? message.model : "";
  if (
    !usage ||
    typeof usage !== "object" ||
    !Number.isFinite(at) ||
    !model ||
    model === "<synthetic>"
  ) {
    return null;
  }
  const messageId = typeof message.id === "string" ? message.id : null;
  const requestId = typeof rec.requestId === "string" ? rec.requestId : null;
  const created = tokenCount(usage.cache_creation_input_tokens);
  const split = usage.cache_creation as Record<string, unknown> | undefined;
  const oneHour = split
    ? Math.min(created, tokenCount(split.ephemeral_1h_input_tokens))
    : 0;

  return {
    at,
    runner: CLAUDE_RUNNER_ID,
    model,
    sessionId: typeof rec.sessionId === "string" ? rec.sessionId : "",
    key:
      messageId === null && requestId === null
        ? null
        : `${messageId ?? ""}:${requestId ?? ""}`,
    input: tokenCount(usage.input_tokens),
    cacheRead: tokenCount(usage.cache_read_input_tokens),
    cacheWrite5m: created - oneHour,
    cacheWrite1h: oneHour,
    output: tokenCount(usage.output_tokens),
    costUsd: null,
    ...speedOf(usage.speed),
  };
}

const scanner = new JsonlScanner<UsageRecord, undefined>(
  (line) => parseUsageLine(line),
  () => undefined,
);

export function claudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/** Every record from transcripts written to at or after `sinceMs`. */
export async function loadUsageRecords(
  sinceMs: number,
  root = claudeProjectsDir(),
): Promise<UsageRecord[]> {
  const found = await listJsonl(root);

  return scanner.records(found.filter((f) => f.mtimeMs >= sinceMs));
}

/** Test seam. */
export function resetUsageRecordCache(): void {
  scanner.reset();
}
