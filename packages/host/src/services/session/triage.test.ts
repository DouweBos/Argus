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
  setSessionStatus,
  setSessionArchived,
  setSessionUnread,
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

  it("sets a status with a note, keeps the note across status changes, and clears both", () => {
    setSessionStatus("s1", "in_review", "  waiting\non   CI ", "agent");
    expect(sessionTriage("s1")).toMatchObject({
      workflow_status: "in_review",
      status_note: "waiting on CI",
      settled: false,
    });
    setSessionStatus("s1", "done", undefined, "user");
    expect(sessionTriage("s1")).toMatchObject({
      workflow_status: "done",
      status_note: "waiting on CI",
      settled: true,
    });
    setSessionStatus("s1", null, null, "user");
    expect(sessionTriage("s1")).toMatchObject({
      workflow_status: null,
      status_note: null,
      settled: null,
    });
  });

  it("maps an older client's settle onto the status", () => {
    setSessionSettled("s1", false);
    expect(sessionTriage("s1").workflow_status).toBe("in_progress");
    setSessionSettled("s1", true);
    expect(sessionTriage("s1").workflow_status).toBe("done");
  });

  it("migrates a v1 file's done and kept-active sessions", () => {
    stopSessionTriage();
    addSession("s2");
    addSession("s3");
    const file = path.join(home, "session-triage.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        sessions: [
          { id: "s1", settled: true, unread: true },
          { id: "s2", settled: false },
          { id: "s3", last_message_at: 5 },
        ],
      }),
    );
    startSessionTriage();

    expect(sessionTriage("s1")).toMatchObject({
      workflow_status: "done",
      settled: true,
      unread: true,
    });
    expect(sessionTriage("s2").workflow_status).toBe("in_progress");
    expect(sessionTriage("s3")).toMatchObject({
      workflow_status: null,
      last_message_at: 5,
    });
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as {
      version: number;
      sessions: Record<string, unknown>[];
    };
    expect(saved.version).toBe(2);
    expect(saved.sessions.some((r) => "settled" in r)).toBe(false);
  });

  it("archives without touching the worktree, dropping its unread and snooze, and restores", () => {
    vi.useFakeTimers();
    markSessionUnread("s1");
    snoozeSession("s1", Date.now() + 60_000);
    setSessionArchived("s1", true);
    expect(sessionTriage("s1")).toMatchObject({
      unread: false,
      snoozed_until: null,
    });
    expect(sessionTriage("s1").archived_at).toBeTypeOf("number");
    expect(appState.sessions.has("s1")).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(notify).not.toHaveBeenCalled();

    stopSessionTriage();
    startSessionTriage();
    expect(sessionTriage("s1").archived_at).toBeTypeOf("number");
    setSessionArchived("s1", false);
    expect(sessionTriage("s1").archived_at).toBeNull();
  });

  it("marks unread by hand until a client opens it", () => {
    setSessionUnread("s1", true);
    expect(sessionTriage("s1").unread).toBe(true);
    markSessionRead("s1");
    expect(sessionTriage("s1").unread).toBe(false);
    setSessionUnread("s1", true);
    setSessionUnread("s1", false);
    expect(sessionTriage("s1").unread).toBe(false);
    expect(() => setSessionUnread("gone", true)).toThrow();
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
