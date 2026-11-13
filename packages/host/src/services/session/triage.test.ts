import type { Session } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import {
  markSessionRead,
  markSessionUnread,
  sessionTriage,
  setSessionSettled,
  snoozeSession,
  startSessionTriage,
  stopSessionTriage,
} from "./triage";

const notify = vi.hoisted(() => vi.fn());
vi.mock("../notifications/osNotification", () => ({
  showAgentNotification: notify,
}));

let home: string;
let previousHome: string | undefined;

function addSession(id: string): void {
  appState.sessions.set(id, {
    id,
    kind: "worktree",
    branch: "feature",
    display_name: "Feature",
    description: "",
    path: `/tmp/${id}`,
    repo_root: "/tmp/repo",
    status: "ready",
  } as Session);
}

describe("session triage", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-triage-"));
    process.env.ARGUS_HOME = home;
    addSession("s1");
    startSessionTriage();
  });

  afterEach(() => {
    stopSessionTriage();
    vi.useRealTimers();
    notify.mockReset();
    appState.sessions.clear();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("follows the pull request until marked, and survives a restart", () => {
    expect(sessionTriage("s1").settled).toBeNull();
    setSessionSettled("s1", true);
    stopSessionTriage();
    startSessionTriage();

    expect(sessionTriage("s1").settled).toBe(true);
    setSessionSettled("s1", null);
    expect(sessionTriage("s1").settled).toBeNull();
  });

  it("clears unread when opened and when marked done", () => {
    markSessionUnread("s1");
    expect(sessionTriage("s1").unread).toBe(true);
    markSessionRead("s1");
    expect(sessionTriage("s1").unread).toBe(false);
    markSessionUnread("s1");
    setSessionSettled("s1", true);
    expect(sessionTriage("s1").unread).toBe(false);
  });

  it("wakes a snoozed session with a notification", async () => {
    vi.useFakeTimers();
    const updates: unknown[] = [];
    const remove = addHostEventSink((channel, args) => {
      if (channel === "session:updated") {
        updates.push(args[0]);
      }
    });
    snoozeSession("s1", Date.now() + 60_000);
    expect(sessionTriage("s1").snoozed_until).not.toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);
    remove();

    expect(sessionTriage("s1").snoozed_until).toBeNull();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(updates).toContainEqual({ id: "s1" });
  });

  it("refuses a time in the past", () => {
    expect(() => snoozeSession("s1", Date.now() - 1)).toThrow();
  });

  it("forgets a deleted session", () => {
    vi.useFakeTimers();
    snoozeSession("s1", Date.now() + 60_000);
    emitHostEvent("session:deleted", "s1");
    vi.advanceTimersByTime(60_000);

    expect(notify).not.toHaveBeenCalled();
    expect(sessionTriage("s1").snoozed_until).toBeNull();
  });
});
