// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "@argus/remote-client";
import type { RemoteAgentStatus, RemoteMessage } from "../lib/protocol";
import { useAgentsStore } from "./agents";
import { useConnectionStore } from "./connection";
import { resetHostStores, routeEvent } from "./hostSync";
import { useProjectsStore } from "./projects";
import { usePromptsStore } from "./prompts";
import { useTranscriptsStore } from "./transcripts";

type Handler = (params: Record<string, unknown>) => unknown;

/** A transport that answers from a table, and records what it was asked. */
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
    subscribe: vi.fn(),
    disconnect: vi.fn(),
  };
  useConnectionStore.setState({
    transport: transport as unknown as Transport,
    connection: "ready",
  });

  return { transport, calls };
}

function agent(id: string, status = "idle"): RemoteAgentStatus {
  return { agent_id: id, session_id: "s1", status } as RemoteAgentStatus;
}

function msg(id: string, text = id): RemoteMessage {
  return { id, role: "assistant", text_blocks: [text], tool_calls: [] };
}

function event(name: string, payload: unknown, agentId?: string) {
  return { type: "evt" as const, seq: 1, event: name, agent_id: agentId, payload };
}

function page(messages: RemoteMessage[], revision: number) {
  return {
    messages,
    next_after: null,
    prev_before: null,
    epoch: "e",
    revision,
  };
}

function delta(revision: number, messages: RemoteMessage[]) {
  return {
    agent_id: "a1",
    epoch: "e",
    revision,
    total: messages.length,
    messages,
    removed_ids: [],
    title: null,
    model: null,
    pending_tool_name: null,
    tasks: null,
    todos: null,
  };
}

beforeEach(() => {
  resetHostStores();
});

afterEach(() => {
  vi.useRealTimers();
  useConnectionStore.setState({ transport: null, connection: "offline" });
});

describe("event routing", () => {
  it("updates an agent everywhere it is listed", () => {
    useProjectsStore.setState({
      agentsByRepo: { "/r": [agent("a1"), agent("a2")] },
      recentAgents: [agent("a2")],
    });

    routeEvent(event("agent.status", agent("a1", "running")));

    const { agentsByRepo, recentAgents } = useProjectsStore.getState();
    expect(agentsByRepo["/r"].map((a) => a.status)).toEqual([
      "running",
      "idle",
    ]);
    // An agent the recent list didn't have goes on top.
    expect(recentAgents.map((a) => a.agent_id)).toEqual(["a1", "a2"]);
    expect(useAgentsStore.getState().statusByAgent.a1.status).toBe("running");
  });

  it("files queues and capabilities under the event's agent", () => {
    routeEvent(event("agent.queue", { agent_id: "a1", messages: [] }, "a1"));
    routeEvent(
      event("agent.capabilities", { models: [], commands: [], agents: [] }, "a1"),
    );

    expect(useAgentsStore.getState().queuedByAgent.a1).toEqual([]);
    expect(useAgentsStore.getState().capabilitiesByAgent.a1).toBeDefined();
  });

  it("holds a prompt until it is cancelled", () => {
    const prompt = {
      agent_id: "a1",
      tool_use_id: "t1",
      tool_name: "Bash",
      tool_input: {},
    };
    routeEvent(event("permission.request", prompt));
    expect(usePromptsStore.getState().prompts["a1:t1"]).toEqual(prompt);

    routeEvent(event("permission.cancel", { agent_id: "a1", tool_use_id: "t1" }));
    expect(usePromptsStore.getState().prompts).toEqual({});
  });

  it("ignores events no store owns", () => {
    expect(() => routeEvent(event("terminal.data", {}))).not.toThrow();
  });
});

describe("transcripts", () => {
  it("applies deltas that follow the page and refetches on a gap", async () => {
    vi.useFakeTimers();
    const { calls } = fakeTransport({
      "agents.transcript": () => page([msg("m1")], 1),
    });
    await useTranscriptsStore.getState().loadTranscript("a1");

    routeEvent(event("agent.transcript", delta(2, [msg("m2")])));
    expect(
      useTranscriptsStore.getState().messagesByAgent.a1.map((m) => m.id),
    ).toEqual(["m1", "m2"]);

    // Revision 4 skips 3: the page is stale, so it is fetched again.
    routeEvent(event("agent.transcript", delta(4, [msg("m4")])));
    await vi.advanceTimersByTimeAsync(400);
    expect(calls.filter(([m]) => m === "agents.transcript")).toHaveLength(2);
  });

  it("drops an optimistic bubble the computer parked on its queue", async () => {
    fakeTransport({
      "agents.send": () => ({ queued: true }),
      "agents.queue_list": () => ({ messages: [] }),
      "agents.status": () => ({ agent: agent("a1", "running") }),
    });

    await useTranscriptsStore.getState().sendMessage("a1", "hello");

    expect(useTranscriptsStore.getState().optimisticByAgent.a1).toEqual([]);
  });
});

describe("prompts", () => {
  it("clears an answered prompt at once and remembers it was answered", async () => {
    fakeTransport({
      "permission.respond": () => ({ accepted: true }),
      "agents.transcript": () => page([], 1),
    });
    usePromptsStore.setState({
      prompts: {
        "a1:t1": {
          agent_id: "a1",
          tool_use_id: "t1",
          tool_name: "Bash",
          tool_input: {},
        },
      },
    });

    await usePromptsStore.getState().respond("a1", "t1", "allow");

    expect(usePromptsStore.getState().prompts).toEqual({});
    expect(usePromptsStore.getState().answered["a1:t1"]).toBe(true);
  });
});

describe("a host switch", () => {
  it("drops everything the last host sent", () => {
    useProjectsStore.setState({ projects: [{ repo_root: "/r", name: "r" }] });
    useAgentsStore.setState({ statusByAgent: { a1: agent("a1") } });
    useTranscriptsStore.setState({ messagesByAgent: { a1: [msg("m1")] } });

    resetHostStores();

    expect(useProjectsStore.getState().projects).toEqual([]);
    expect(useAgentsStore.getState().statusByAgent).toEqual({});
    expect(useTranscriptsStore.getState().messagesByAgent).toEqual({});
  });
});
