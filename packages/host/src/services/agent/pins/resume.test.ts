import type { ResumeDeps } from "./resume";
import type { PinnedChat } from "./store";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({
  addHostEventSink: vi.fn(),
  emitHostEvent: vi.fn(),
}));
const captured: [string, unknown][] = [];
vi.mock("../../telemetry/telemetry", () => ({
  capture: (name: string, props: unknown) => captured.push([name, props]),
}));
vi.mock("../agentService", () => ({
  launchAgent: vi.fn(),
  setAgentEffort: vi.fn(),
}));
vi.mock("../../session/manager", () => ({ listSessions: vi.fn() }));
vi.mock("../conversation/live", () => ({ liveConversation: () => null }));
const setTitle = vi.fn();
vi.mock("../conversation/actions", () => ({
  setConversationTitle: (...args: unknown[]) => setTitle(...args),
}));

const { appState } = await import("../../../state");
const store = await import("./store");
const { resumePinnedChats } = await import("./resume");

const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "argus-pin-wt-"));

function pin(id: string, extra: Partial<PinnedChat> = {}): void {
  store.putPin({
    agentId: id,
    sessionId: "s1",
    repoRoot: "/repo",
    runnerSessionId: `claude-${id}`,
    runnerId: "claude-code",
    model: "claude-haiku",
    permissionMode: "plan",
    pinnedAt: Date.now(),
    ...extra,
  });
}

function deps(overrides: Partial<ResumeDeps> = {}): ResumeDeps & {
  launch: ReturnType<typeof vi.fn>;
  setEffort: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
} {
  return {
    launch: vi.fn(async (o: { agentId?: string }) => ({
      agent_id: o.agentId ?? "x",
    })),
    setEffort: vi.fn(async () => undefined),
    findSession: async (p: PinnedChat) =>
      (appState.sessions.get(p.sessionId) as never) ?? null,
    ready: async () => undefined,
    sleep: vi.fn(async () => undefined),
    notify: vi.fn(),
    ...overrides,
  } as never;
}

function reset(): void {
  fs.rmSync(path.join(process.env.ARGUS_HOME!, "pinned-chats.json"), {
    force: true,
  });
  store.resetPinCache();
  appState.agents.clear();
  appState.sessions.clear();
  appState.sessions.set("s1", {
    id: "s1",
    repo_root: "/repo",
    path: worktree,
    availability: "available",
  } as never);
  captured.length = 0;
  setTitle.mockClear();
}

describe("resuming pinned chats at boot", () => {
  beforeEach(reset);

  it("brings each back idle on its own id, conversation and settings", async () => {
    pin("a1", { effort: "high", title: "Fix it" });
    pin("a2");
    const d = deps();

    const summary = await resumePinnedChats(d);

    expect(summary).toMatchObject({ resumed: 2, missing: 0, failed: 0 });
    expect(d.launch).toHaveBeenCalledWith({
      sessionId: "s1",
      model: "claude-haiku",
      permissionMode: "plan",
      resumeSessionId: "claude-a1",
      agentId: "a1",
      runnerId: "claude-code",
      fresh: true,
    });
    expect(d.setEffort).toHaveBeenCalledWith("a1", "high");
    expect(d.setEffort).toHaveBeenCalledTimes(1);
    expect(setTitle).toHaveBeenCalledWith("a1", "Fix it");
    // Staggered: one pause between the two spawns.
    expect(d.sleep).toHaveBeenCalledTimes(1);
    expect(captured).toContainEqual([
      "agents_auto_resumed",
      {
        pinned_count: 2,
        resumed_count: 2,
        missing_count: 0,
        failed_count: 0,
      },
    ]);
  });

  it("unpins and tells the user about a chat whose worktree is gone", async () => {
    pin("a1");
    pin("a2", { sessionId: "gone" });
    appState.sessions.set("s1", {
      id: "s1",
      repo_root: "/repo",
      path: path.join(worktree, "deleted"),
    } as never);
    const d = deps();

    const summary = await resumePinnedChats(d);

    expect(summary.missing).toBe(2);
    expect(d.launch).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledTimes(2);
    expect(store.listPins()).toEqual([]);
  });

  it("keeps a pin whose spawn failed, or whose drive is unplugged", async () => {
    pin("a1");
    pin("a2", { sessionId: "s2" });
    appState.sessions.set("s2", {
      id: "s2",
      repo_root: "/repo",
      path: worktree,
      availability: "unavailable",
    } as never);
    const d = deps({
      launch: vi.fn(async () => {
        throw "no account";
      }),
    });

    const summary = await resumePinnedChats(d);

    expect(summary).toMatchObject({ resumed: 0, failed: 1, skipped: 1 });
    expect(store.listPins().map((p) => p.agentId)).toEqual(["a1", "a2"]);
  });

  it("skips one already running, and does nothing with no pins", async () => {
    const d = deps();
    await expect(resumePinnedChats(d)).resolves.toMatchObject({ resumed: 0 });
    expect(captured).toEqual([]);

    pin("a1");
    appState.agents.set("a1", {} as never);
    await expect(resumePinnedChats(d)).resolves.toMatchObject({ skipped: 1 });
    expect(d.launch).not.toHaveBeenCalled();
  });

  it("starts a pin that never ran a turn fresh, under its id", async () => {
    pin("a1", { runnerSessionId: undefined });
    const d = deps();

    await resumePinnedChats(d);

    expect(d.launch).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "a1", resumeSessionId: undefined }),
    );
  });
});
