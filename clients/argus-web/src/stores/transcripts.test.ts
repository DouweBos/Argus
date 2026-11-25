// @vitest-environment jsdom
import type { Transport } from "@argus/remote-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentsStore } from "./agents";
import { useConnectionStore } from "./connection";
import { resetHostStores } from "./hostSync";
import { useTranscriptsStore } from "./transcripts";

type Handler = (params: Record<string, unknown>) => unknown;

function fakeTransport(handlers: Record<string, Handler>) {
  const calls: string[] = [];
  const transport = {
    request: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push(method);
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

const optimistic = (agentId: string) =>
  useTranscriptsStore.getState().optimisticByAgent[agentId] ?? [];

afterEach(() => resetHostStores());

describe("sendMessage", () => {
  it("keeps the bubble when the message joins the turn", async () => {
    const calls = fakeTransport({
      "agents.send": () => ({ queued: false }),
      "agents.transcript": () => ({ messages: [], next_after: null }),
    });
    await useTranscriptsStore.getState().sendMessage("a1", "also check b.ts");
    expect(optimistic("a1")).toHaveLength(1);
    expect(calls).not.toContain("agents.queue_list");
  });

  it("moves a message the host queued into the queue strip", async () => {
    const queued = [{ id: "q1", message: "also check b.ts" }];
    fakeTransport({
      "agents.send": () => ({ queued: true }),
      "agents.queue_list": () => ({ messages: queued }),
      "agents.status": () => ({ agent: { agent_id: "a1", status: "running" } }),
    });
    await useTranscriptsStore.getState().sendMessage("a1", "also check b.ts");
    expect(optimistic("a1")).toEqual([]);
    await vi.waitFor(() =>
      expect(useAgentsStore.getState().queuedByAgent.a1).toEqual(queued),
    );
  });
});
