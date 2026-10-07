import type {
  AgentTranscriptDelta,
  AgentTranscriptPage,
} from "@argus/remote-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearConversation,
  getConversationState,
} from "../stores/conversationStore";
import { followTranscript, resetTranscriptFollows } from "./transcriptSync";

const handlers = vi.hoisted(
  () => new Map<string, (e: { payload: unknown }) => void>(),
);
const telemetry = vi.hoisted(() => vi.fn());
const ipc = vi.hoisted(() => ({
  getAgentTranscript: vi.fn(),
  getAgentSnapshot: vi.fn(),
}));

vi.mock("./events", () => ({
  listen: async (channel: string, fn: (e: { payload: unknown }) => void) => {
    handlers.set(channel, fn);

    return () => handlers.delete(channel);
  },
}));
vi.mock("./ipc", () => ipc);
vi.mock("./telemetry", () => ({ capture: telemetry }));

const AGENT = "a1";

function message(i: number) {
  return {
    id: `m${i}`,
    role: "assistant" as const,
    textBlocks: [`m${i}`],
    toolCalls: [],
    timestamp: i,
  };
}

function page(revision: number, count: number): AgentTranscriptPage {
  return {
    epoch: "e",
    revision,
    start: 0,
    total: count,
    messages: Array.from({ length: count }, (_, i) => message(i)),
    meta: {},
  };
}

function append(revision: number, index: number): AgentTranscriptDelta {
  return {
    agentId: AGENT,
    epoch: "e",
    revision,
    total: index + 1,
    ops: [{ op: "append", index, message: message(index) }],
  };
}

function push(delta: AgentTranscriptDelta): void {
  handlers.get(`agent:transcript:${AGENT}`)?.({ payload: delta });
}

const shown = () =>
  getConversationState().conversations[AGENT]?.messages.map((m) => m.id);

describe("followTranscript", () => {
  afterEach(() => {
    resetTranscriptFollows();
    clearConversation(AGENT);
    handlers.clear();
    vi.clearAllMocks();
  });

  it("loads the newest page, then applies deltas in order", async () => {
    ipc.getAgentTranscript.mockResolvedValue(page(1, 2));
    followTranscript(AGENT);
    await vi.waitFor(() => expect(shown()).toEqual(["m0", "m1"]));

    push(append(2, 2));

    expect(shown()).toEqual(["m0", "m1", "m2"]);
  });

  it("replays deltas that arrive while the page is in flight", async () => {
    let resolve!: (p: AgentTranscriptPage) => void;
    ipc.getAgentTranscript.mockReturnValue(
      new Promise<AgentTranscriptPage>((r) => (resolve = r)),
    );
    followTranscript(AGENT);
    await vi.waitFor(() => expect(handlers.size).toBeGreaterThan(0));
    // Revision 2 is in the page; 3 is not.
    push(append(2, 1));
    push(append(3, 2));
    resolve(page(2, 2));

    await vi.waitFor(() => expect(shown()).toEqual(["m0", "m1", "m2"]));
  });

  it("refetches after a gap", async () => {
    ipc.getAgentTranscript.mockResolvedValueOnce(page(1, 1));
    followTranscript(AGENT);
    await vi.waitFor(() => expect(shown()).toEqual(["m0"]));

    ipc.getAgentTranscript.mockResolvedValueOnce(page(5, 3));
    push(append(5, 2));

    await vi.waitFor(() => expect(shown()).toEqual(["m0", "m1", "m2"]));
    expect(ipc.getAgentTranscript).toHaveBeenCalledTimes(2);
    expect(telemetry).toHaveBeenCalledWith("agent_transcript_resynced", {
      new_epoch: false,
    });
  });

  it("reads an older host's snapshot when it has no transcript command", async () => {
    ipc.getAgentTranscript.mockRejectedValue(
      new Error("unknown command get_agent_transcript"),
    );
    ipc.getAgentSnapshot.mockResolvedValue(
      JSON.stringify({ messages: [message(0)] }),
    );
    followTranscript(AGENT);

    await vi.waitFor(() => expect(shown()).toEqual(["m0"]));
  });
});
