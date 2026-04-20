// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffFiles } from "./useDiffFiles";

// ---------------------------------------------------------------------------
// Mock window.argus
// ---------------------------------------------------------------------------

type EventHandler = (payload: unknown) => void;
const eventListeners = new Map<string, Set<EventHandler>>();

function emitEvent(event: string, payload: unknown = {}) {
  const handlers = eventListeners.get(event);
  if (handlers) {
    for (const handler of handlers) {
      handler(payload);
    }
  }
}

(window as unknown as Record<string, unknown>).argus = {
  invoke: vi.fn().mockResolvedValue(undefined),
  on: (event: string, callback: EventHandler) => {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set());
    }
    eventListeners.get(event)!.add(callback);

    return () => {
      eventListeners.get(event)?.delete(callback);
    };
  },
};

// ---------------------------------------------------------------------------
// Mock IPC
// ---------------------------------------------------------------------------

const SIMPLE_DIFF = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,4 @@
 import { app } from "electron";
+import path from "path";

 app.whenReady().then(() => {
`;

const UNTRACKED_DIFF = `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`;

const mockGetSessionFullDiff = vi.fn().mockResolvedValue(SIMPLE_DIFF);
const mockGetSessionStagedDiff = vi.fn().mockResolvedValue("");
const mockGetSessionUntrackedDiff = vi.fn().mockResolvedValue("");
const mockGetSessionConflicts = vi.fn().mockResolvedValue([]);
const mockWatchSession = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/ipc", () => ({
  getSessionFullDiff: (...args: unknown[]) => mockGetSessionFullDiff(...args),
  getSessionStagedDiff: (...args: unknown[]) =>
    mockGetSessionStagedDiff(...args),
  getSessionUntrackedDiff: (...args: unknown[]) =>
    mockGetSessionUntrackedDiff(...args),
  getSessionConflicts: (...args: unknown[]) => mockGetSessionConflicts(...args),
  watchSession: (...args: unknown[]) => mockWatchSession(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useDiffFiles", () => {
  beforeEach(() => {
    eventListeners.clear();
    mockGetSessionFullDiff.mockResolvedValue(SIMPLE_DIFF);
    mockGetSessionStagedDiff.mockResolvedValue("");
    mockGetSessionUntrackedDiff.mockResolvedValue("");
    mockGetSessionConflicts.mockResolvedValue([]);
    mockWatchSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed DiffFile[] from fetched diffs", async () => {
    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    expect(result.current.files[0].newPath).toBe("src/main.ts");
    expect(result.current.files[0].status).toBe("M");
  });

  it("merges staged info into files", async () => {
    mockGetSessionStagedDiff.mockResolvedValue(SIMPLE_DIFF);

    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    expect(result.current.files[0].staged).toBe("full");
  });

  it("appends untracked files as status A with staged none", async () => {
    mockGetSessionFullDiff.mockResolvedValue("");
    mockGetSessionUntrackedDiff.mockResolvedValue(UNTRACKED_DIFF);

    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    expect(result.current.files[0].status).toBe("A");
    expect(result.current.files[0].staged).toBe("none");
    expect(result.current.files[0].newPath).toBe("new.txt");
  });

  it("returns conflictFiles when baseBranch is provided", async () => {
    mockGetSessionConflicts.mockResolvedValue(["file1.ts", "file2.ts"]);

    const { result } = renderHook(() =>
      useDiffFiles("ws-1", { baseBranch: "main" }),
    );

    await waitFor(() => {
      expect(result.current.conflictFiles).toEqual(["file1.ts", "file2.ts"]);
    });
  });

  it("returns empty conflictFiles when baseBranch is null", async () => {
    const { result } = renderHook(() =>
      useDiffFiles("ws-1", { baseBranch: null }),
    );

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    expect(result.current.conflictFiles).toEqual([]);
    expect(mockGetSessionConflicts).not.toHaveBeenCalled();
  });

  it("sets isLoading during fetch and clears when done", async () => {
    const { result } = renderHook(() => useDiffFiles("ws-1"));

    // Eventually settles to false
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.files).toHaveLength(1);
  });

  it("sets error on fetch failure", async () => {
    mockGetSessionFullDiff.mockRejectedValue(new Error("git failed"));

    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.error).toBe("git failed");
    });

    expect(result.current.files).toEqual([]);
  });

  it("calls watchSession on mount", async () => {
    const { unmount } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(mockWatchSession).toHaveBeenCalledWith("ws-1");
    });

    unmount();
  });

  it("re-fetches when session:diff-changed event fires", async () => {
    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    // Change what the mock returns
    mockGetSessionFullDiff.mockResolvedValue("");
    mockGetSessionUntrackedDiff.mockResolvedValue("");

    act(() => {
      emitEvent("session:diff-changed:ws-1");
    });

    await waitFor(() => {
      expect(result.current.files).toHaveLength(0);
    });
  });

  it("refetch() triggers a fresh fetch", async () => {
    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    expect(mockGetSessionFullDiff).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockGetSessionFullDiff).toHaveBeenCalledTimes(2);
  });
});
