import type * as GitModule from "../session/git";
import type { Session } from "../session/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    sessions: new Map(),
    simulatorReservations: new Map(),
  },
}));
vi.mock("../appSettings/store", () => ({
  loadAppSettings: () => ({ default_llm: { runner: "claude-code" } }),
}));
vi.mock("../session/manager", () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(async () => undefined),
}));
vi.mock("../session/metadata", () => ({
  loadMetadata: () => new Map(),
  saveMetadata: vi.fn(),
}));
vi.mock("../session/sessionOps", () => ({
  gitCommit: vi.fn(async () => ""),
  mergeSessionIntoBase: vi.fn(async () => undefined),
  pushSessionBranch: vi.fn(async () => ({})),
  stageAll: vi.fn(async () => undefined),
}));
vi.mock("../session/git", async (importOriginal) => ({
  ...(await importOriginal<typeof GitModule>()),
  git: vi.fn(async () => ""),
}));
vi.mock("../session/watcher", () => ({
  computeSessionDiffStats: vi.fn(async () => ({
    additions: 12,
    deletions: 3,
    files: 2,
  })),
}));
vi.mock("../terminal/multiplexer", () => ({
  listTerminals: vi.fn(() => [
    { runTitle: "Dev server", exited: false, exitCode: null },
    { runTitle: "Unit tests", exited: true, exitCode: 1 },
    { runTitle: null, exited: false, exitCode: null },
  ]),
}));
vi.mock("../browser/cdpScreencast", () => ({
  cdpCall: vi.fn(),
  isScreencasting: () => false,
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("./startWhenReady", () => ({
  startAgentWhenReady: vi.fn(async () => undefined),
}));
vi.mock("./githubRemote", () => ({
  createRemotePullRequest: vi.fn(async () => ({
    number: 7,
    url: "https://github.com/o/r/pull/7",
  })),
}));

const { appState } = await import("../../state");
const manager = vi.mocked(await import("../session/manager"));
const ops = vi.mocked(await import("../session/sessionOps"));
const { startAgentWhenReady } = vi.mocked(await import("./startWhenReady"));
const {
  createCompareRun,
  isTestRun,
  keepCompareSlot,
  scoreCompareRun,
  slotSuffixes,
} = await import("./compareRemote");

function slot(id: string, n: number, runner: string): Session {
  return {
    id,
    kind: "worktree",
    branch: `fix-${runner}`,
    description: "Fix the header",
    path: `/wt/${id}`,
    repo_root: "/repo",
    status: "ready",
    base_branch: "main",
    compare_group: {
      id: "g1",
      slot: n,
      runner_id: runner,
      model: null,
      effort: null,
    },
  };
}

describe("compareRemote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.sessions.clear();
    appState.agents.clear();
  });

  describe("slotSuffixes", () => {
    it("names a slot after its runner", () => {
      expect(
        slotSuffixes([{ runner_id: "codex" }, { runner_id: "acp-gemini" }]),
      ).toEqual(["codex", "acp-gemini"]);
    });

    it("adds the model when a runner repeats, and a number when that still clashes", () => {
      expect(
        slotSuffixes([
          { runner_id: "claude-code", model: "opus" },
          { runner_id: "claude-code", model: "sonnet" },
          {},
        ]),
      ).toEqual(["claude-code-opus", "claude-code-sonnet", "claude-code"]);
      expect(slotSuffixes([{}, {}])).toEqual([
        "claude-code-1",
        "claude-code-2",
      ]);
    });
  });

  describe("isTestRun", () => {
    it("reads test-like titles as tests", () => {
      expect(isTestRun("Unit tests")).toBe(true);
      expect(isTestRun("e2e")).toBe(true);
      expect(isTestRun("Dev server")).toBe(false);
      expect(isTestRun("Contest")).toBe(false);
    });
  });

  describe("createCompareRun", () => {
    it("creates a grouped session per slot and starts each with the same prompt", async () => {
      manager.createSession.mockImplementation(
        async (_root, _branch, _desc, _existing, _base, _llm, opts) =>
          ({ id: `s${opts?.compareGroup?.slot}` }) as Session,
      );
      const run = await createCompareRun({
        repoRoot: "/repo",
        description: "",
        prompt: "Fix the header",
        slots: [
          { runner_id: "claude-code", model: "opus", effort: "high" },
          { runner_id: "codex" },
        ],
      });

      expect(run.sessions.map((s) => s.id)).toEqual(["s0", "s1"]);
      const opts = manager.createSession.mock.calls.map((c) => c[6]);
      expect(opts.map((o) => o?.compareGroup?.id)).toEqual([
        run.groupId,
        run.groupId,
      ]);
      expect(opts.map((o) => o?.branchSuffix)).toEqual([
        "claude-code",
        "codex",
      ]);
      expect(manager.createSession.mock.calls[0]?.[5]).toEqual({
        runner: "claude-code",
        model: "opus",
      });
      expect(startAgentWhenReady).toHaveBeenCalledWith(
        "s0",
        "Fix the header",
        expect.objectContaining({ effort: "high", runnerId: "claude-code" }),
      );
      expect(startAgentWhenReady).toHaveBeenCalledTimes(2);
    });
  });

  describe("scoreCompareRun", () => {
    it("scores each slot in order with its diff, runs, cost and tokens", async () => {
      appState.sessions.set("b", slot("b", 1, "codex"));
      appState.sessions.set("a", slot("a", 0, "claude-code"));
      appState.agents.set("x", {
        agentId: "x",
        sessionId: "a",
        createdAt: 1,
        costUsd: 0.5,
        tokensTotal: 1200,
        status: "idle",
      } as never);

      const slots = await scoreCompareRun("g1");

      expect(slots.map((s) => s.session_id)).toEqual(["a", "b"]);
      expect(slots[0]).toMatchObject({
        agent_id: "x",
        agent_status: "idle",
        diff: { files: 2, insertions: 12, deletions: 3 },
        cost_usd: 0.5,
        tokens: 1200,
        has_screen: false,
        runs: [
          { title: "Dev server", state: "running", is_test: false },
          { title: "Unit tests", state: "failed", is_test: true },
        ],
      });
      expect(slots[1]).toMatchObject({ agent_id: null, cost_usd: 0 });
    });

    it("refuses a group that doesn't exist", async () => {
      await expect(scoreCompareRun("nope")).rejects.toMatch(/No compare run/);
    });
  });

  describe("keepCompareSlot", () => {
    it("merges the winner, ungroups it and deletes the other slots with their branches", async () => {
      appState.sessions.set("a", slot("a", 0, "claude-code"));
      appState.sessions.set("b", slot("b", 1, "codex"));
      appState.sessions.set("c", slot("c", 2, "acp-gemini"));

      const kept = await keepCompareSlot({
        sessionId: "b",
        land: "merge",
        strategy: "squash",
        deleteOthers: true,
      });

      expect(ops.mergeSessionIntoBase).toHaveBeenCalledWith("b", "squash");
      expect(appState.sessions.get("b")?.compare_group).toBeNull();
      expect(manager.deleteSession.mock.calls).toEqual([
        ["a", true],
        ["c", true],
      ]);
      expect(kept).toEqual({ pullRequestUrl: null, deleted: 2 });
    });

    it("opens a pull request and leaves the others when asked to", async () => {
      appState.sessions.set("a", slot("a", 0, "claude-code"));
      appState.sessions.set("b", slot("b", 1, "codex"));

      const kept = await keepCompareSlot({
        sessionId: "a",
        land: "pull_request",
        deleteOthers: false,
      });

      expect(ops.pushSessionBranch).toHaveBeenCalledWith("a");
      expect(kept.pullRequestUrl).toBe("https://github.com/o/r/pull/7");
      expect(manager.deleteSession).not.toHaveBeenCalled();
    });

    it("deletes nothing when landing fails", async () => {
      appState.sessions.set("a", slot("a", 0, "claude-code"));
      appState.sessions.set("b", slot("b", 1, "codex"));
      ops.mergeSessionIntoBase.mockRejectedValueOnce("conflicts");

      await expect(
        keepCompareSlot({ sessionId: "a", land: "merge", deleteOthers: true }),
      ).rejects.toBe("conflicts");
      expect(manager.deleteSession).not.toHaveBeenCalled();
      expect(appState.sessions.get("a")?.compare_group?.id).toBe("g1");
    });
  });
});
