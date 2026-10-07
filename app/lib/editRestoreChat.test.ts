import { describe, expect, it, vi } from "vitest";
import { notifyMessageSent } from "./agentEventService";
import { editAndRestoreFromMessage } from "./editRestoreChat";
import { rewindAgent } from "./ipc";

vi.mock("./ipc", () => ({
  rewindAgent: vi.fn(async () => ({
    claude_session_id: "claude-new",
    restoredPrompt: "old text",
  })),
}));

vi.mock("./agentEventService", () => ({
  notifyMessageSent: vi.fn(),
}));

describe("editAndRestoreFromMessage", () => {
  it("has the host rewind to the message and send the edit in its place", async () => {
    await editAndRestoreFromMessage("session-1", "agent-1", "m3", "new text");

    expect(notifyMessageSent).toHaveBeenCalledWith("agent-1");
    expect(rewindAgent).toHaveBeenCalledWith("agent-1", "m3", {
      resend: { text: "new text" },
    });
  });
});
