import type { Session } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink } from "@argus/host/bus";
import { appState } from "../../state";
import { saveConversation } from "../agent/chatHistory";
import {
  THROTTLE_MS,
  flushLastMessage,
  stampAgentMessage,
  stampUserMessage,
  stopLastMessageStamps,
} from "./lastMessage";
import { sessionTriage, startSessionTriage, stopSessionTriage } from "./triage";

let home: string;
let previousHome: string | undefined;
let updates: string[];
let removeSink: () => void;

function addSession(id: string, repoRoot = "/tmp/repo"): void {
  appState.sessions.set(id, {
    id,
    kind: "worktree",
    branch: "feature",
    description: "",
    path: `/tmp/${id}`,
    repo_root: repoRoot,
    status: "ready",
  } as Session);
}

describe("last message stamps", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-last-message-"));
    process.env.ARGUS_HOME = home;
    addSession("s1");
    startSessionTriage();
    updates = [];
    removeSink = addHostEventSink((channel, args) => {
      if (channel === "session:updated") {
        updates.push((args[0] as { id: string }).id);
      }
    });
  });

  afterEach(() => {
    removeSink();
    stopLastMessageStamps();
    stopSessionTriage();
    vi.useRealTimers();
    appState.sessions.clear();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("sends a user message at once", () => {
    stampUserMessage("s1");
    expect(updates).toEqual(["s1"]);
    expect(sessionTriage("s1").last_message_at).toBe(1_000_000);
  });

  it("throttles a streaming agent to one update per window", () => {
    stampAgentMessage("s1");
    expect(updates).toHaveLength(1);
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(100);
      stampAgentMessage("s1");
    }
    expect(updates).toHaveLength(1);
    // The listing reads the fresh time even while the update is held back.
    expect(sessionTriage("s1").last_message_at).toBe(1_005_000);
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(updates).toHaveLength(2);
    vi.advanceTimersByTime(THROTTLE_MS * 3);
    expect(updates).toHaveLength(2);
  });

  it("sends what the throttle holds when the turn ends", () => {
    stampAgentMessage("s1");
    vi.advanceTimersByTime(1_000);
    stampAgentMessage("s1");
    flushLastMessage("s1");
    expect(updates).toHaveLength(2);
    flushLastMessage("s1");
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(updates).toHaveLength(2);
  });

  it("survives a restart, held stamps included", () => {
    stampUserMessage("s1");
    vi.advanceTimersByTime(1_000);
    stampAgentMessage("s1");
    stopLastMessageStamps();
    stopSessionTriage();
    startSessionTriage();
    expect(sessionTriage("s1").last_message_at).toBe(1_001_000);
  });

  it("ignores a deleted session", () => {
    stampUserMessage("gone");
    expect(updates).toEqual([]);
    expect(sessionTriage("gone").last_message_at).toBeNull();
  });

  it("backfills from saved chat history", () => {
    const repo = path.join(home, "repo");
    addSession("old", repo);
    for (const [endedAt, argusSessionId] of [
      [500, "old"],
      [700, "old"],
      [900, "other"],
    ] as const) {
      saveConversation(repo, {
        id: `chat-${endedAt}`,
        sessionId: `claude-${endedAt}`,
        argusSessionId,
        title: "t",
        sessionBranch: "b",
        sessionDescription: "",
        messageCount: 1,
        createdAt: 1,
        endedAt,
        messages: [],
      });
    }
    expect(sessionTriage("old").last_message_at).toBe(700);
    stampUserMessage("old");
    expect(sessionTriage("old").last_message_at).toBe(1_000_000);
  });
});
