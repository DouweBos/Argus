import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentState } from "../stores/agentStore";
import { startAgentListening, stopAgentListening } from "./agentEventService";
import { startAgentInSession } from "./agentLifecycle";
import { startAgent } from "./ipc";

vi.mock("./ipc", () => ({ startAgent: vi.fn() }));
vi.mock("./agentEventService", () => ({
  notifyMessageSent: vi.fn(),
  startAgentListening: vi.fn(),
  stopAgentListening: vi.fn(),
}));
vi.mock("./transcriptSync", () => ({ refetch: vi.fn(async () => {}) }));
vi.mock("../stores/sessionStore", () => ({
  selectSession: vi.fn(),
  sessionHostId: () => "local",
}));
vi.mock("../stores/editorStore", () => ({ setActiveCenterView: vi.fn() }));

describe("startAgentInSession", () => {
  beforeEach(() => {
    vi.mocked(startAgent).mockReset();
  });

  it("moves the tab to the warm agent the host handed over", async () => {
    vi.mocked(startAgent).mockImplementation(async () => ({
      agent_id: "warm-1",
      session_id: "s1",
      status: "idle",
      parent_agent_id: null,
      created_at: 1,
      model: "opus",
      runner_id: "claude-code",
    }));

    const info = await startAgentInSession("s1", { permissionMode: "auto" });
    const minted = vi.mocked(startAgent).mock.calls[0]![5]!;

    expect(info.agent_id).toBe("warm-1");
    expect(Object.keys(getAgentState().agents)).toEqual(["warm-1"]);
    expect(getAgentState().activeAgentId.s1).toBe("warm-1");
    expect(stopAgentListening).toHaveBeenCalledWith(minted);
    expect(startAgentListening).toHaveBeenCalledWith("warm-1");
  });
});
