import type { LlmStreamEvent } from "../../../agent/conversation/types";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  emptyConversation,
  reduceEvent,
} from "../../../agent/conversation/reducer";
import { ClaudeCodeHandle } from "./handle";

const result = (total: number, extra: object = {}) => ({
  type: "result",
  subtype: "success",
  duration_ms: 1,
  total_cost_usd: total,
  usage: { input_tokens: 10, output_tokens: 1 },
  ...extra,
});
const since = (...costs: number[]) => ({
  model_usage_since_last_result: Object.fromEntries(
    costs.map((costUSD, i) => [`model-${i}`, { costUSD }]),
  ),
});

/** What the handle passes on for these CLI lines. */
async function forwarded(
  events: object[],
  resumed = false,
): Promise<LlmStreamEvent[]> {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    killed: false,
  });
  const handle = new ClaudeCodeHandle({
    agentId: "a1",
    child: child as unknown as ChildProcess,
    stdin,
    combinedSystemPrompt: "",
    resumed,
  });
  const out: LlmStreamEvent[] = [];
  handle.on("stream-event", (l: string) => out.push(JSON.parse(l)));
  for (const event of events) {
    stdout.write(`${JSON.stringify(event)}\n`);
  }
  await new Promise((r) => setTimeout(r, 5));

  return out;
}

const costs = (events: LlmStreamEvent[]) =>
  events.flatMap((e) =>
    e.type === "result"
      ? [
          e.total_cost_usd === undefined
            ? null
            : Number(e.total_cost_usd.toFixed(6)),
        ]
      : [],
  );

describe("claude Code's running cost, as each turn's", () => {
  it("doesn't count earlier turns again", async () => {
    const out = await forwarded([result(0.1), result(0.25), result(0.3)]);

    expect(costs(out)).toEqual([0.1, 0.15, 0.05]);
    expect(out.reduce(reduceEvent, emptyConversation()).totalCost).toBeCloseTo(
      0.3,
    );
  });

  it("takes the CLI's own figure for the turn when it gives one", async () => {
    const out = await forwarded(
      [result(0.9, since(0.1, 0.05)), result(1.2, since(0.3))],
      true,
    );

    expect(costs(out)).toEqual([0.15, 0.3]);
  });

  it("counts nothing for a turn that called no model", async () => {
    const out = await forwarded([result(0.4, since())], true);

    expect(costs(out)).toEqual([0]);
  });

  it("leaves a resume's first turn to be priced from its tokens", async () => {
    const out = await forwarded([result(5), result(5.2)], true);

    expect(costs(out)).toEqual([null, 0.2]);
  });

  it("starts over after /clear", async () => {
    const out = await forwarded([
      result(0.5),
      { type: "conversation_reset", session_id: "a" },
      result(0.6),
    ]);

    expect(costs(out)).toEqual([0.5, 0.6]);
  });

  it("follows a total that restarted on its own", async () => {
    const out = await forwarded([result(0.5), result(0.2)]);

    expect(costs(out)).toEqual([0.5, 0.2]);
  });

  it("keeps its place through a crash result's zeroed total", async () => {
    const out = await forwarded([result(0.5), result(0), result(0.6)]);

    expect(costs(out)).toEqual([0.5, 0, 0.1]);
  });
});
