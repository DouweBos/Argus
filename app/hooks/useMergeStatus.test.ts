// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMergeStatus } from "./useMergeStatus";

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

const mockGetWorkspaceConflicts = vi.fn().mockResolvedValue([]);
const mockGetWorkspaceStagedDiff = vi.fn().mockResolvedValue("");
const mockMergeWorkspaceIntoBase = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/ipc", () => ({
  getWorkspaceConflicts: (...args: unknown[]) =>
    mockGetWorkspaceConflicts(...args),
  getWorkspaceStagedDiff: (...args: unknown[]) =>
    mockGetWorkspaceStagedDiff(...args),
  mergeWorkspaceIntoBase: (...args: unknown[]) =>
    mockMergeWorkspaceIntoBase(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMergeStatus", () => {
  beforeEach(() => {
    eventListeners.clear();
    mockGetWorkspaceConflicts.mockResolvedValue([]);
    mockGetWorkspaceStagedDiff.mockResolvedValue("");
    mockMergeWorkspaceIntoBase.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns hasStaged true when staged diff is non-empty", async () => {
    mockGetWorkspaceStagedDiff.mockResolvedValue("diff --git a/f.ts b/f.ts\n");

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(result.current.hasStaged).toBe(true);
    });
  });

  it("returns hasStaged false when staged diff is empty", async () => {
    mockGetWorkspaceStagedDiff.mockResolvedValue("");

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(mockGetWorkspaceStagedDiff).toHaveBeenCalled();
    });

    expect(result.current.hasStaged).toBe(false);
  });

  it("returns conflict list from getWorkspaceConflicts", async () => {
    mockGetWorkspaceConflicts.mockResolvedValue(["a.ts", "b.ts"]);

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(result.current.conflicts).toEqual(["a.ts", "b.ts"]);
    });
  });

  it("handleMerge calls mergeWorkspaceIntoBase", async () => {
    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(mockGetWorkspaceConflicts).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.handleMerge();
    });

    expect(mockMergeWorkspaceIntoBase).toHaveBeenCalledWith("ws-1");
    expect(result.current.isMerging).toBe(false);
  });

  it("handleMerge captures error in mergeError on failure", async () => {
    mockMergeWorkspaceIntoBase.mockRejectedValue(
      new Error("merge conflict detected"),
    );

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(mockGetWorkspaceConflicts).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.handleMerge();
    });

    expect(result.current.mergeError).toBe("merge conflict detected");
    expect(result.current.isMerging).toBe(false);
  });

  it("no-ops when workspaceId is null", async () => {
    const { result } = renderHook(() => useMergeStatus(null));

    // Give it a tick to settle
    await act(async () => {});

    expect(mockGetWorkspaceConflicts).not.toHaveBeenCalled();
    expect(mockGetWorkspaceStagedDiff).not.toHaveBeenCalled();
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.hasStaged).toBe(false);
  });

  it("re-fetches status on workspace:diff-changed event", async () => {
    mockGetWorkspaceStagedDiff.mockResolvedValue("");

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(mockGetWorkspaceStagedDiff).toHaveBeenCalledTimes(1);
    });

    // Now staged changes appear
    mockGetWorkspaceStagedDiff.mockResolvedValue("some staged diff\n");

    act(() => {
      emitEvent("workspace:diff-changed:ws-1");
    });

    await waitFor(() => {
      expect(result.current.hasStaged).toBe(true);
    });
  });
});
