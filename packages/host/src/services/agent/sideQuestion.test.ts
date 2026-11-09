import { beforeEach, describe, expect, it, vi } from "vitest";

const execFile = vi.fn();
vi.mock("node:child_process", () => ({ execFile }));
vi.mock("@argus/host/logger", () => ({ warn: vi.fn() }));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("../claudeAuth/accounts", () => ({
  envForAccount: vi.fn(() => ({ PATH: "/bin" })),
  resolveAccountForSession: vi.fn(() => "default"),
}));
vi.mock("../llm/runners/claudeCode/transcriptFork", () => ({
  ensureClaudeTranscriptAt: vi.fn(),
}));
const liveConversation = vi.fn();
vi.mock("./conversation/live", () => ({ liveConversation }));

const { appState } = await import("../../state");
const { capture } = vi.mocked(await import("../telemetry/telemetry"));
const { askSideQuestion, sideQuestionArgs } = await import("./sideQuestion");

/** Make the next `claude` call print `stdout`, or fail with `error`. */
function cliReturns(stdout: string, error: unknown = null): void {
  execFile.mockImplementationOnce(
    (
      _bin: string,
      _args: string[],
      _opts: unknown,
      cb: (e: unknown, out?: string) => void,
    ) => {
      queueMicrotask(() => (error ? cb(error) : cb(null, stdout)));

      return { stdin: { end: vi.fn() } };
    },
  );
}

describe("sideQuestionArgs", () => {
  it("resumes a throwaway, read-only fork", () => {
    const args = sideQuestionArgs({
      claudeSessionId: "c1",
      model: "opus",
      question: "--why?",
    });

    expect(args).toEqual(
      expect.arrayContaining([
        "--resume",
        "c1",
        "--fork-session",
        "--no-session-persistence",
        "--strict-mcp-config",
      ]),
    );
    const tools = args.slice(
      args.indexOf("--tools") + 1,
      args.indexOf("--tools") + 4,
    );
    expect(tools).toEqual(["Read", "Grep", "Glob"]);
    expect(args).not.toContain("Edit");
    expect(args).not.toContain("Bash");
    // A question starting with a dash is still the prompt, not a flag.
    expect(args.slice(-2)).toEqual(["--", "--why?"]);
  });
});

describe("askSideQuestion", () => {
  beforeEach(() => {
    execFile.mockReset();
    capture.mockClear();
    appState.agents.clear();
    appState.sessions.clear();
    appState.sessions.set("s1", { id: "s1", path: "/wt" } as never);
    appState.agents.set("a1", {
      agentId: "a1",
      sessionId: "s1",
      status: "running",
      model: "sonnet",
      runner: { id: "claude-code" },
    } as never);
    liveConversation.mockReturnValue({ sessionId: "c1" });
  });

  it("answers from the agent's worktree and counts it", async () => {
    cliReturns(JSON.stringify({ result: " In foo.ts. " }));

    await expect(askSideQuestion("a1", " where? ")).resolves.toEqual({
      answer: "In foo.ts.",
    });
    const [bin, args, opts] = execFile.mock.calls[0]!;
    expect(bin).toBe("claude");
    expect(args).toContain("sonnet");
    expect(args.at(-1)).toBe("where?");
    expect(opts).toMatchObject({ cwd: "/wt" });
    expect(capture).toHaveBeenCalledWith("agent_side_question", {
      agent_busy: true,
      duration_bucket: "<10s",
      success: true,
    });
  });

  it("refuses an agent with no conversation yet", async () => {
    liveConversation.mockReturnValue({});

    await expect(askSideQuestion("a1", "hi")).rejects.toMatch(
      /no conversation/,
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  it("refuses an empty question and other runners", async () => {
    await expect(askSideQuestion("a1", "  ")).rejects.toMatch(/Ask a question/);
    appState.agents.set("a1", {
      ...appState.agents.get("a1")!,
      runner: { id: "custom" },
    } as never);
    await expect(askSideQuestion("a1", "hi")).rejects.toMatch(/Claude Code/);
  });

  it("reports a CLI error result and a timeout", async () => {
    cliReturns(
      JSON.stringify({ is_error: true, result: "Prompt is too long" }),
    );
    await expect(askSideQuestion("a1", "hi")).rejects.toBe(
      "Prompt is too long",
    );

    cliReturns("", { killed: true });
    await expect(askSideQuestion("a1", "hi")).rejects.toBe(
      "The side question timed out",
    );
    expect(capture).toHaveBeenLastCalledWith(
      "agent_side_question",
      expect.objectContaining({ success: false }),
    );
  });
});
