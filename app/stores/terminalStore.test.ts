import { describe, expect, it, beforeEach } from "vitest";
import { useTerminalStore } from "./terminalStore";
import type { TerminalSession } from "../lib/types";

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
    useTerminalStore.setState({
      sessions: {},
      activeSessionId: {},
      runSessionId: {},
      runBusy: {},
      bufferCache: {},
    });
  });

  describe("sessions", () => {
    it("adds a session and sets it as active", () => {
      useTerminalStore.getState().addSession(session());
      const sessions = useTerminalStore
        .getState()
        .getSessionsForWorkspace("ws-1");
      expect(sessions).toHaveLength(1);
      expect(useTerminalStore.getState().getActiveSessionId("ws-1")).toBe(
        "sess-1",
      );
    });

    it("adds multiple sessions to the same workspace", () => {
      useTerminalStore.getState().addSession(session());
      useTerminalStore
        .getState()
        .addSession(session({ id: "sess-2", title: "Build" }));
      const sessions = useTerminalStore
        .getState()
        .getSessionsForWorkspace("ws-1");
      expect(sessions).toHaveLength(2);
      // Latest addition becomes active
      expect(useTerminalStore.getState().getActiveSessionId("ws-1")).toBe(
        "sess-2",
      );
    });

    it("removes a session and falls back to the last remaining", () => {
      useTerminalStore.getState().addSession(session());
      useTerminalStore
        .getState()
        .addSession(session({ id: "sess-2", title: "Build" }));
      useTerminalStore.getState().setActiveSession("ws-1", "sess-2");
      useTerminalStore.getState().removeSession("ws-1", "sess-2");

      const sessions = useTerminalStore
        .getState()
        .getSessionsForWorkspace("ws-1");
      expect(sessions).toHaveLength(1);
      expect(useTerminalStore.getState().getActiveSessionId("ws-1")).toBe(
        "sess-1",
      );
    });

    it("keeps active when removing a non-active session", () => {
      useTerminalStore.getState().addSession(session());
      useTerminalStore
        .getState()
        .addSession(session({ id: "sess-2", title: "Build" }));
      useTerminalStore.getState().setActiveSession("ws-1", "sess-1");
      useTerminalStore.getState().removeSession("ws-1", "sess-2");
      expect(useTerminalStore.getState().getActiveSessionId("ws-1")).toBe(
        "sess-1",
      );
    });

    it("updates session fields", () => {
      useTerminalStore.getState().addSession(session());
      useTerminalStore.getState().updateSession("sess-1", { title: "Renamed" });
      const sessions = useTerminalStore
        .getState()
        .getSessionsForWorkspace("ws-1");
      expect(sessions[0].title).toBe("Renamed");
    });

    it("returns empty array for unknown workspace", () => {
      expect(
        useTerminalStore.getState().getSessionsForWorkspace("nope"),
      ).toEqual([]);
    });

    it("returns null for unknown active session", () => {
      expect(useTerminalStore.getState().getActiveSessionId("nope")).toBeNull();
    });
  });

  describe("buffer cache", () => {
    it("caches and retrieves buffer data", () => {
      useTerminalStore.getState().cacheBuffer("sess-1", "hello world");
      expect(useTerminalStore.getState().getBuffer("sess-1")).toBe(
        "hello world",
      );
    });

    it("returns null for unknown session", () => {
      expect(useTerminalStore.getState().getBuffer("nope")).toBeNull();
    });

    it("clears buffer data", () => {
      useTerminalStore.getState().cacheBuffer("sess-1", "data");
      useTerminalStore.getState().clearBuffer("sess-1");
      expect(useTerminalStore.getState().getBuffer("sess-1")).toBeNull();
    });
  });

  describe("run session", () => {
    it("sets and gets run session ID", () => {
      useTerminalStore.getState().setRunSession("ws-1", "sess-run");
      expect(useTerminalStore.getState().getRunSessionId("ws-1")).toBe(
        "sess-run",
      );
    });

    it("tracks run busy state", () => {
      expect(useTerminalStore.getState().isRunBusy("ws-1")).toBe(false);
      useTerminalStore.getState().setRunBusy("ws-1", true);
      expect(useTerminalStore.getState().isRunBusy("ws-1")).toBe(true);
    });
  });

  describe("migrateSessions", () => {
    it("moves sessions from one workspace to another", () => {
      useTerminalStore.getState().addSession(session());
      useTerminalStore.getState().migrateSessions("ws-1", "ws-2");

      expect(
        useTerminalStore.getState().getSessionsForWorkspace("ws-1"),
      ).toHaveLength(0);
      const migrated = useTerminalStore
        .getState()
        .getSessionsForWorkspace("ws-2");
      expect(migrated).toHaveLength(1);
      expect(migrated[0].workspace_id).toBe("ws-2");
    });

    it("is a no-op when from === to", () => {
      useTerminalStore.getState().addSession(session());
      useTerminalStore.getState().migrateSessions("ws-1", "ws-1");
      expect(
        useTerminalStore.getState().getSessionsForWorkspace("ws-1"),
      ).toHaveLength(1);
    });

    it("preserves existing sessions at destination", () => {
      useTerminalStore.getState().addSession(session());
      useTerminalStore
        .getState()
        .addSession(
          session({ id: "sess-dst", workspace_id: "ws-2", title: "Existing" }),
        );
      useTerminalStore.getState().migrateSessions("ws-1", "ws-2");
      expect(
        useTerminalStore.getState().getSessionsForWorkspace("ws-2"),
      ).toHaveLength(2);
    });
  });
});
