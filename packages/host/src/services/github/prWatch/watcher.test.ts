import type { PrSnapshot } from "./snapshot";
import type { Session } from "../../session/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPrSnapshot = vi.fn<() => Promise<PrSnapshot>>();
const submitAgentMessage = vi.fn(
  async (
    _agentId: string,
    _message: { displayText?: string; text: string },
  ) => ({
    queued: false,
  }),
);
const notify = vi.fn();
const emitted: [string, unknown][] = [];

vi.mock("./fetch", () => ({
  fetchPrSnapshot,
  failedLogExcerpt: vi.fn(async () => "FAIL a.test.ts"),
}));
vi.mock("../../agent/conversation/actions", () => ({ submitAgentMessage }));
vi.mock("../../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("@argus/host/logger", () => ({ warn: vi.fn() }));
vi.mock("../../../platform", () => ({ hostPlatform: () => ({ notify }) }));
vi.mock("../sessionPullRequests", () => ({
  sessionPullRequest: () => ({
    number: 7,
    state: "open",
    url: "https://github.com/o/r/pull/7",
  }),
  sessionPullRequestMayHaveChanged: vi.fn(),
}));
vi.mock("@argus/host/bus", () => ({
  addHostEventSink: vi.fn(() => () => undefined),
  emitHostEvent: (channel: string, payload: unknown) =>
    emitted.push([channel, payload]),
}));

const { appState } = await import("../../../state");
const { capture } = vi.mocked(await import("../../telemetry/telemetry"));
const { stopPrWatches, unwatchPullRequest, watchPullRequest } =
  await import("./watcher");
const { isPullRequestWatched, POLL_MS } = await import("./watched");

function snap(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    number: 7,
    url: "https://github.com/o/r/pull/7",
    state: "OPEN",
    mergeable: "MERGEABLE",
    headOid: "a1",
    viewer: "me",
    checks: [
      {
        name: "ci",
        bucket: "pending",
        required: false,
        detailsUrl: null,
        failures: [],
      },
    ],
    comments: [],
    ...overrides,
  };
}

function addAgent(agentId: string, status = "idle", createdAt = 1): void {
  appState.agents.set(agentId, {
    agentId,
    sessionId: "s1",
    status,
    parentAgentId: null,
    createdAt,
  } as never);
}

describe("pull request watch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitted.length = 0;
    appState.sessions.set("s1", {
      id: "s1",
      repo_root: "/repo",
      path: "/wt",
      branch: "feat",
    } as Session);
    addAgent("a1");
  });

  afterEach(() => {
    stopPrWatches();
    appState.sessions.clear();
    appState.agents.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("reports status and marks the session watched", async () => {
    fetchPrSnapshot.mockResolvedValue(snap());
    const status = await watchPullRequest("s1", { agentId: "a1", via: "mcp" });
    expect(status).toMatchObject({ pr_number: 7, checks: { pending: 1 } });
    expect(isPullRequestWatched("s1")).toBe(true);
    expect(emitted).toContainEqual([
      "session:updated",
      { id: "s1", repo_root: "/repo", pull_request_watched: true },
    ]);
    expect(submitAgentMessage).not.toHaveBeenCalled();
  });

  it("wakes the agent with the failing check on a later poll", async () => {
    fetchPrSnapshot.mockResolvedValue(snap());
    await watchPullRequest("s1", { agentId: "a1", via: "mcp" });
    fetchPrSnapshot.mockResolvedValue(
      snap({
        checks: [
          {
            name: "ci",
            bucket: "fail",
            required: false,
            detailsUrl: "https://github.com/o/r/actions/runs/1/job/2",
            failures: [],
          },
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(submitAgentMessage).toHaveBeenCalledTimes(1);
    const [agentId, message] = submitAgentMessage.mock.calls[0]!;
    expect(agentId).toBe("a1");
    expect(message.displayText).toBe("PR #7: ci failed");
    expect(message.text).toContain("FAIL a.test.ts");
  });

  it("falls back to the session's live agent, then to a notification", async () => {
    fetchPrSnapshot.mockResolvedValue(snap());
    await watchPullRequest("s1", { agentId: "a1", via: "ui" });
    appState.agents.get("a1")!.status = "stopped";
    addAgent("a2", "idle", 5);
    fetchPrSnapshot.mockResolvedValue(snap({ mergeable: "CONFLICTING" }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(submitAgentMessage.mock.calls[0]?.[0]).toBe("a2");

    appState.agents.clear();
    fetchPrSnapshot.mockResolvedValue(
      snap({ mergeable: "CONFLICTING", headOid: "a2" }),
    );
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(submitAgentMessage).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("ends when the PR merges", async () => {
    fetchPrSnapshot.mockResolvedValue(snap());
    await watchPullRequest("s1", { via: "ui" });
    fetchPrSnapshot.mockResolvedValue(snap({ state: "MERGED" }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(isPullRequestWatched("s1")).toBe(false);
    expect(capture).toHaveBeenCalledWith("pr_watch_ended", {
      reason: "merged",
      wakes_bucket: "0",
    });
  });

  it("stops on request and leaves nothing registered when gh fails", async () => {
    fetchPrSnapshot.mockResolvedValue(snap());
    await watchPullRequest("s1", { via: "ui" });
    expect(unwatchPullRequest("s1", "ui")).toBe(true);
    expect(isPullRequestWatched("s1")).toBe(false);

    fetchPrSnapshot.mockRejectedValue(new Error("gh: not logged in"));
    await expect(watchPullRequest("s1", { via: "ui" })).rejects.toMatch(
      /Could not read the pull request/,
    );
    expect(isPullRequestWatched("s1")).toBe(false);
  });
});
