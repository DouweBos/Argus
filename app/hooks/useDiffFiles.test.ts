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

const mockGetWorkspaceFullDiff = vi.fn().mockResolvedValue(SIMPLE_DIFF);
const mockGetWorkspaceStagedDiff = vi.fn().mockResolvedValue("");
const mockGetWorkspaceUntrackedDiff = vi.fn().mockResolvedValue("");
const mockGetWorkspaceConflicts = vi.fn().mockResolvedValue([]);
const mockWatchWorkspace = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/ipc", () => ({
  getWorkspaceFullDiff: (...args: unknown[]) =>
    mockGetWorkspaceFullDiff(...args),
  getWorkspaceStagedDiff: (...args: unknown[]) =>
    mockGetWorkspaceStagedDiff(...args),
  getWorkspaceUntrackedDiff: (...args: unknown[]) =>
    mockGetWorkspaceUntrackedDiff(...args),
  getWorkspaceConflicts: (...args: unknown[]) =>
    mockGetWorkspaceConflicts(...args),
  watchWorkspace: (...args: unknown[]) => mockWatchWorkspace(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useDiffFiles", () => {
  beforeEach(() => {
    eventListeners.clear();
    mockGetWorkspaceFullDiff.mockResolvedValue(SIMPLE_DIFF);
    mockGetWorkspaceStagedDiff.mockResolvedValue("");
    mockGetWorkspaceUntrackedDiff.mockResolvedValue("");
    mockGetWorkspaceConflicts.mockResolvedValue([]);
    mockWatchWorkspace.mockResolvedValue(undefined);
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
    mockGetWorkspaceStagedDiff.mockResolvedValue(SIMPLE_DIFF);

    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    expect(result.current.files[0].staged).toBe("full");
  });

  it("appends untracked files as status A with staged none", async () => {
    mockGetWorkspaceFullDiff.mockResolvedValue("");
    mockGetWorkspaceUntrackedDiff.mockResolvedValue(UNTRACKED_DIFF);

    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    expect(result.current.files[0].status).toBe("A");
    expect(result.current.files[0].staged).toBe("none");
    expect(result.current.files[0].newPath).toBe("new.txt");
  });

  it("returns conflictFiles when baseBranch is provided", async () => {
    mockGetWorkspaceConflicts.mockResolvedValue(["file1.ts", "file2.ts"]);

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
    expect(mockGetWorkspaceConflicts).not.toHaveBeenCalled();
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
    mockGetWorkspaceFullDiff.mockRejectedValue(new Error("git failed"));

    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.error).toBe("git failed");
    });

    expect(result.current.files).toEqual([]);
  });

  it("calls watchWorkspace on mount", async () => {
    const { unmount } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(mockWatchWorkspace).toHaveBeenCalledWith("ws-1");
    });

    unmount();
  });

  it("re-fetches when workspace:diff-changed event fires", async () => {
    const { result } = renderHook(() => useDiffFiles("ws-1"));

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    // Change what the mock returns
    mockGetWorkspaceFullDiff.mockResolvedValue("");
    mockGetWorkspaceUntrackedDiff.mockResolvedValue("");

    act(() => {
      emitEvent("workspace:diff-changed:ws-1");
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

    expect(mockGetWorkspaceFullDiff).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockGetWorkspaceFullDiff).toHaveBeenCalledTimes(2);
  });
});
