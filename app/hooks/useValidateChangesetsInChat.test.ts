// @vitest-environment jsdom
import type { ReleaseNoteEntry } from "../lib/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useValidateChangesetsInChat } from "./useValidateChangesetsInChat";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStartAgentInSession = vi
  .fn<
    (id: string, opts?: { focus?: boolean }) => Promise<{ agent_id: string }>
  >()
  .mockResolvedValue({ agent_id: "agent-1" });
const mockSendUserMessageToAgent = vi
  .fn<
    (
      agentId: string,
      prompt: string,
      attachments: unknown,
      opts?: { assumeIdle?: boolean },
    ) => Promise<void>
  >()
  .mockResolvedValue(undefined);

vi.mock("../lib/agentLifecycle", () => ({
  startAgentInSession: (id: string, opts?: { focus?: boolean }) =>
    mockStartAgentInSession(id, opts),
  sendUserMessageToAgent: (
    agentId: string,
    prompt: string,
    attachments: unknown,
    opts?: { assumeIdle?: boolean },
  ) => mockSendUserMessageToAgent(agentId, prompt, attachments, opts),
}));

function cs(filename: string, summary = "summary"): ReleaseNoteEntry {
  return {
    filename: `.changeset/${filename}`,
    format: "changesets",
    content: summary,
    status: "added",
    labels: [{ name: "argus", value: "patch", tone: "success" }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useValidateChangesetsInChat", () => {
  beforeEach(() => {
    mockStartAgentInSession.mockResolvedValue({ agent_id: "agent-1" });
    mockSendUserMessageToAgent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches a prompt that references the base branch and changesets", async () => {
    const { result } = renderHook(() =>
      useValidateChangesetsInChat({
        sessionId: "ws-1",
        baseBranch: "main",
        sessionBranch: "feat",
        changesets: [cs("silly-cats.md", "Keep the cats."), cs("stale-fix.md")],
      }),
    );

    await act(async () => {
      await result.current.dispatch();
    });

    await waitFor(() => {
      expect(mockStartAgentInSession).toHaveBeenCalledWith("ws-1", {
        focus: true,
      });
      expect(mockSendUserMessageToAgent).toHaveBeenCalled();
    });

    const prompt = mockSendUserMessageToAgent.mock.calls[0]?.[1];
    expect(prompt).toContain("main");
    expect(prompt).toContain("feat");
    expect(prompt).toContain(".changeset/silly-cats.md");
    expect(prompt).toContain(".changeset/stale-fix.md");
    // The prompt must tell the agent not to touch other files.
    expect(prompt).toMatch(/Do not touch any files outside `.changeset\/`/);
  });

  it("no-ops when there are no changesets to validate", async () => {
    const { result } = renderHook(() =>
      useValidateChangesetsInChat({
        sessionId: "ws-1",
        baseBranch: "main",
        sessionBranch: "feat",
        changesets: [],
      }),
    );

    await act(async () => {
      await result.current.dispatch();
    });

    expect(mockStartAgentInSession).not.toHaveBeenCalled();
    expect(mockSendUserMessageToAgent).not.toHaveBeenCalled();
  });

  it("no-ops when baseBranch or sessionBranch is missing", async () => {
    const { result } = renderHook(() =>
      useValidateChangesetsInChat({
        sessionId: "ws-1",
        baseBranch: null,
        sessionBranch: "feat",
        changesets: [cs("a.md")],
      }),
    );

    await act(async () => {
      await result.current.dispatch();
    });

    expect(mockStartAgentInSession).not.toHaveBeenCalled();
  });

  it("records an error and resets isDispatching when dispatch throws", async () => {
    mockStartAgentInSession.mockRejectedValue(new Error("start failed"));

    const { result } = renderHook(() =>
      useValidateChangesetsInChat({
        sessionId: "ws-1",
        baseBranch: "main",
        sessionBranch: "feat",
        changesets: [cs("a.md")],
      }),
    );

    await act(async () => {
      await result.current.dispatch();
    });

    expect(result.current.error).toBe("start failed");
    expect(result.current.isDispatching).toBe(false);
  });
});
