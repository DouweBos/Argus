import type { TerminalSession } from "../lib/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addSession,
  cacheBuffer,
  clearBuffer,
  getActiveSessionId,
  getBuffer,
  getRunSessionId,
  getSessionsForWorkspace,
  isRunBusy,
  migrateSessions,
  removeSession,
  setActiveSession,
  setRunBusy,
  setRunSession,
  setTerminalState,
  updateSession,
} from "./terminalStore";

function session(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "sess-1",
    title: "Shell",
    workspace_id: "ws-1",
    ...overrides,
  };
}

describe("terminalStore", () => {
  beforeEach(() => {
    setTerminalState({
      sessions: {},
      activeSessionId: {},
      runSessionId: {},
      runBusy: {},
      bufferCache: {},
    });
  });

  describe("sessions", () => {
    it("adds a session and sets it as active", () => {
      addSession(session());
      const sessions = getSessionsForWorkspace("ws-1");
      expect(sessions).toHaveLength(1);
      expect(getActiveSessionId("ws-1")).toBe("sess-1");
    });

    it("adds multiple sessions to the same workspace", () => {
      addSession(session());
      addSession(session({ id: "sess-2", title: "Build" }));
      const sessions = getSessionsForWorkspace("ws-1");
      expect(sessions).toHaveLength(2);
      expect(getActiveSessionId("ws-1")).toBe("sess-2");
    });

    it("removes a session and falls back to the last remaining", () => {
      addSession(session());
      addSession(session({ id: "sess-2", title: "Build" }));
      setActiveSession("ws-1", "sess-2");
      removeSession("ws-1", "sess-2");

      const sessions = getSessionsForWorkspace("ws-1");
      expect(sessions).toHaveLength(1);
      expect(getActiveSessionId("ws-1")).toBe("sess-1");
    });

    it("keeps active when removing a non-active session", () => {
      addSession(session());
      addSession(session({ id: "sess-2", title: "Build" }));
      setActiveSession("ws-1", "sess-1");
      removeSession("ws-1", "sess-2");
      expect(getActiveSessionId("ws-1")).toBe("sess-1");
    });

    it("updates session fields", () => {
      addSession(session());
      updateSession("sess-1", { title: "Renamed" });
      const sessions = getSessionsForWorkspace("ws-1");
      expect(sessions[0].title).toBe("Renamed");
    });

    it("returns empty array for unknown workspace", () => {
      expect(getSessionsForWorkspace("nope")).toEqual([]);
    });

    it("returns null for unknown active session", () => {
      expect(getActiveSessionId("nope")).toBeNull();
    });
  });

  describe("buffer cache", () => {
    it("caches and retrieves buffer data", () => {
      cacheBuffer("sess-1", "hello world");
      expect(getBuffer("sess-1")).toBe("hello world");
    });

    it("returns null for unknown session", () => {
      expect(getBuffer("nope")).toBeNull();
    });

    it("clears buffer data", () => {
      cacheBuffer("sess-1", "data");
      clearBuffer("sess-1");
      expect(getBuffer("sess-1")).toBeNull();
    });
  });

  describe("run session", () => {
    it("sets and gets run session ID", () => {
      setRunSession("ws-1", "sess-run");
      expect(getRunSessionId("ws-1")).toBe("sess-run");
    });

    it("tracks run busy state", () => {
      expect(isRunBusy("ws-1")).toBe(false);
      setRunBusy("ws-1", true);
      expect(isRunBusy("ws-1")).toBe(true);
    });
  });

  describe("migrateSessions", () => {
    it("moves sessions from one workspace to another", () => {
      addSession(session());
      migrateSessions("ws-1", "ws-2");

      expect(getSessionsForWorkspace("ws-1")).toHaveLength(0);
      const migrated = getSessionsForWorkspace("ws-2");
      expect(migrated).toHaveLength(1);
      expect(migrated[0].workspace_id).toBe("ws-2");
    });

    it("is a no-op when from === to", () => {
      addSession(session());
      migrateSessions("ws-1", "ws-1");
      expect(getSessionsForWorkspace("ws-1")).toHaveLength(1);
    });

    it("preserves existing sessions at destination", () => {
      addSession(session());
      addSession(
        session({ id: "sess-dst", workspace_id: "ws-2", title: "Existing" }),
      );
      migrateSessions("ws-1", "ws-2");
      expect(getSessionsForWorkspace("ws-2")).toHaveLength(2);
    });
  });
});
