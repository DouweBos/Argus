/**
 * A long synthetic chat, opened and streamed the way the desktop does it now:
 * the host folds and diffs, the window applies a page and then deltas.
 * Opt-in: `ARGUS_CONVERSATION_PERF=<out.json>`; run with `--expose-gc` in
 * NODE_OPTIONS for the heap figure.
 */

import type { AgentTranscriptDelta } from "@argus/remote-protocol";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addHostEventSink, resetHostEventSinks } from "@argus/host/bus";
import {
  flushLive,
  liveMeta,
  livePage,
  resetLive,
  seedLive,
  setLive,
} from "@argus/host/services/agent/conversation/live";
import {
  foldLongChat,
  longChatSteps,
  streamingTurn,
} from "@argus/host/services/agent/conversation/longChatFixture";
import {
  reduceEvent,
  withUserMessage,
} from "@argus/host/services/agent/conversation/reducer";
import { toRemoteTranscriptDelta } from "@argus/host/services/remote/transcript";
import {
  applyTranscriptDelta,
  applyTranscriptPage,
  hasRunningSubagents,
} from "../stores/conversationStore";
import { TRANSCRIPT_PAGE } from "./transcriptSync";

const out = process.env.ARGUS_CONVERSATION_PERF;
const AGENT = "perf";

function heap(): number {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  gc?.();

  return process.memoryUsage().heapUsed;
}

function time<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const value = fn();

  return [value, performance.now() - start];
}

const round = (n: number) => Math.round(n * 100) / 100;

function stats(xs: number[]) {
  const sorted = [...xs].sort((a, b) => a - b);

  return {
    n: sorted.length,
    p50: round(sorted[Math.floor(sorted.length / 2)]!),
    p95: round(sorted[Math.floor(sorted.length * 0.95)]!),
    max: round(sorted[sorted.length - 1]!),
    total: round(xs.reduce((a, b) => a + b, 0)),
  };
}

describe.skipIf(!out)("conversation perf", () => {
  it("opens and streams a long chat", () => {
    const report: Record<string, unknown> = {};
    let conv = foldLongChat(longChatSteps({ messages: 4000 }));
    report.messages = conv.messages.length;
    report.history_bytes = JSON.stringify(conv).length;
    resetHostEventSinks();
    resetLive();
    seedLive(AGENT, conv);

    // Open: the host slices a page, the window parses and shows it.
    const [page, pageMs] = time(() =>
      livePage(AGENT, { limit: TRANSCRIPT_PAGE }),
    );
    const json = JSON.stringify(page);
    report.open_page_bytes = json.length;
    const before = heap();
    const [, openMs] = time(() =>
      applyTranscriptPage(AGENT, JSON.parse(json) as NonNullable<typeof page>),
    );
    report.open_host_ms = round(pageMs);
    report.open_renderer_ms = round(openMs);
    report.renderer_heap_mb = round((heap() - before) / 1e6);

    // Streaming: the host folds and diffs; the window applies the delta.
    const deltas: AgentTranscriptDelta[] = [];
    addHostEventSink((channel, args) => {
      if (channel === `agent:transcript:${AGENT}`) {
        deltas.push(args[0] as AgentTranscriptDelta);
      }
    });
    const host: number[] = [];
    const renderer: number[] = [];
    const gateway: number[] = [];
    let bytes = 0;
    for (const step of streamingTurn()) {
      const start = performance.now();
      conv =
        step.kind === "user"
          ? withUserMessage(conv, step.text)
          : reduceEvent(conv, step.event);
      setLive(AGENT, conv);
      flushLive(AGENT);
      const hostMs = performance.now() - start;
      host.push(hostMs);
      const delta = deltas.shift();
      if (!delta) {
        continue;
      }
      const wire = JSON.stringify(delta);
      bytes += wire.length;
      const [, rendererMs] = time(() => {
        applyTranscriptDelta(AGENT, JSON.parse(wire) as AgentTranscriptDelta);
        hasRunningSubagents(AGENT);
      });
      renderer.push(rendererMs);
      const [, gatewayMs] = time(() =>
        toRemoteTranscriptDelta(delta, liveMeta(AGENT) ?? {}),
      );
      gateway.push(gatewayMs);
    }
    report.host_per_event_ms = stats(host);
    report.renderer_per_event_ms = stats(renderer);
    report.gateway_per_delta_ms = stats(gateway);
    report.ipc_bytes_per_delta = Math.round(bytes / renderer.length);

    writeFileSync(out!, JSON.stringify(report, null, 2));
    expect(renderer.length).toBeGreaterThan(0);
  });
});
