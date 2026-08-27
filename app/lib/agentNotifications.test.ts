import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAwaitingAnswerTool,
  notifyAwaitingAnswer,
  notifyPermissionRequested,
} from "./agentNotifications";
import { notifyAgent } from "./ipc";

vi.mock("./ipc", () => ({ notifyAgent: vi.fn(async () => {}) }));
vi.mock("../stores/agentStore", () => ({
  getAgentState: () => ({ agents: { a1: { session_id: "s1" } } }),
}));
vi.mock("../stores/sessionStore", () => ({
  getSessionState: () => ({
    sessions: [{ id: "s1", branch: "feature", repo_root: "/repo/Argus" }],
  }),
}));
vi.mock("../stores/conversationStore", () => ({
  getConversationState: () => ({ conversations: {} }),
}));

const mockNotify = notifyAgent as unknown as ReturnType<typeof vi.fn>;

describe("agentNotifications", () => {
  beforeEach(() => {
    mockNotify.mockClear();
  });

  it("treats questions and plans as awaiting an answer", () => {
    expect(isAwaitingAnswerTool("AskUserQuestion")).toBe(true);
    expect(isAwaitingAnswerTool("ExitPlanMode")).toBe(true);
    expect(isAwaitingAnswerTool("Bash")).toBe(false);
  });

  it("announces a question that had no permission request behind it", () => {
    notifyAwaitingAnswer("a1", "tu-question", "AskUserQuestion");

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const payload = mockNotify.mock.calls[0][0];
    expect(payload.kind).toBe("permission");
    expect(payload.body).toContain("asked you a question");
  });

  it("words a plan differently from a question", () => {
    notifyAwaitingAnswer("a1", "tu-plan", "ExitPlanMode");

    expect(mockNotify.mock.calls[0][0].body).toContain(
      "wants to run its plan by you",
    );
  });

  // Both paths fire in permission-prompting modes; the user should hear once.
  it("announces a prompt only once, whichever path notices first", () => {
    const id = "tu-both-answer-first";
    notifyAwaitingAnswer("a1", id, "AskUserQuestion");
    notifyPermissionRequested("a1", {
      request_id: "r1",
      tool_use_id: id,
      tool_name: "AskUserQuestion",
      tool_input: {},
    });

    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("announces the permission path when it lands first", () => {
    const id = "tu-both-permission-first";
    notifyPermissionRequested("a1", {
      request_id: "r1",
      tool_use_id: id,
      tool_name: "Bash",
      tool_input: {},
    });
    notifyAwaitingAnswer("a1", id, "Bash");

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0].body).toContain("requested Bash");
  });

  it("keeps separate prompts separate", () => {
    notifyAwaitingAnswer("a1", "tu-first", "AskUserQuestion");
    notifyAwaitingAnswer("a1", "tu-second", "AskUserQuestion");

    expect(mockNotify).toHaveBeenCalledTimes(2);
  });
});
