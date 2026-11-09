// @vitest-environment jsdom
import type { Transport } from "@argus/remote-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentsStore } from "./agents";
import { useConnectionStore } from "./connection";
import { resetHostStores } from "./hostSync";
import { useSideQuestionsStore } from "./sideQuestions";

type Handler = (params: Record<string, unknown>) => unknown;

function fakeTransport(handlers: Record<string, Handler>) {
  const calls: [string, Record<string, unknown>][] = [];
  const transport = {
    request: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push([method, params]);
      const handler = handlers[method];
      if (!handler) {
        throw Object.assign(new Error(`no ${method}`), { code: "not_found" });
      }

      return handler(params);
    }),
  };
  useConnectionStore.setState({
    transport: transport as unknown as Transport,
    connection: "ready",
  });

  return calls;
}

const exchanges = (agentId: string) =>
  useSideQuestionsStore.getState().exchangesByAgent[agentId] ?? [];

const EXPECTED =
  "I asked a side question while you were working.\n\nQuestion: Which file?\n\nAnswer: `src/a.ts`";

afterEach(() => resetHostStores());

describe("side questions", () => {
  it("asks the host and keeps the answer per agent", async () => {
    const calls = fakeTransport({
      "agents.ask_side": () => ({ answer: "`src/a.ts`" }),
    });
    const asking = useSideQuestionsStore.getState().ask("a1", "  Which file? ");
    expect(exchanges("a1")).toMatchObject([
      { question: "Which file?", pending: true },
    ]);
    await asking;
    expect(calls[0]).toEqual([
      "agents.ask_side",
      { agent_id: "a1", question: "Which file?" },
    ]);
    expect(exchanges("a1")).toMatchObject([
      { question: "Which file?", answer: "`src/a.ts`", pending: false },
    ]);
    expect(exchanges("a2")).toEqual([]);
  });

  it("keeps the host's reason when the question fails", async () => {
    fakeTransport({
      "agents.ask_side": () => {
        throw new Error("agent has no conversation yet");
      },
    });
    await useSideQuestionsStore.getState().ask("a1", "Which file?");
    const [exchange] = exchanges("a1");
    expect(exchange).toMatchObject({
      pending: false,
      error: "agent has no conversation yet",
    });
    expect(exchange?.answer).toBeUndefined();
  });

  it("sends an answered exchange to an idle agent", async () => {
    const calls = fakeTransport({
      "agents.ask_side": () => ({ answer: "`src/a.ts`" }),
      "agents.send": () => ({ queued: false }),
    });
    await useSideQuestionsStore.getState().ask("a1", "Which file?");
    const id = exchanges("a1")[0]!.id;
    await useSideQuestionsStore.getState().sendToAgent("a1", id);
    const sent = calls.find(([m]) => m === "agents.send");
    expect(sent?.[1]).toMatchObject({ agent_id: "a1", message: EXPECTED });
    expect(exchanges("a1")[0]?.sent).toBe(true);

    await useSideQuestionsStore.getState().sendToAgent("a1", id);
    expect(calls.filter(([m]) => m === "agents.send")).toHaveLength(1);
  });

  it("queues behind a busy agent's turn", async () => {
    const calls = fakeTransport({
      "agents.ask_side": () => ({ answer: "`src/a.ts`" }),
      "agents.queue_add": () => ({ accepted: true }),
    });
    useAgentsStore.setState({
      statusByAgent: {
        a1: { agent_id: "a1", status: "running" } as never,
      },
    });
    await useSideQuestionsStore.getState().ask("a1", "Which file?");
    await useSideQuestionsStore
      .getState()
      .sendToAgent("a1", exchanges("a1")[0]!.id);
    expect(calls.at(-1)).toEqual([
      "agents.queue_add",
      { agent_id: "a1", message: EXPECTED },
    ]);
  });

  it("clears one agent's exchanges", async () => {
    fakeTransport({ "agents.ask_side": () => ({ answer: "yes" }) });
    await useSideQuestionsStore.getState().ask("a1", "Done?");
    await useSideQuestionsStore.getState().ask("a2", "Done?");
    useSideQuestionsStore.getState().clear("a1");
    expect(exchanges("a1")).toEqual([]);
    expect(exchanges("a2")).toHaveLength(1);
  });
});
