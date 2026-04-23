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

const mockGetSessionConflicts = vi.fn().mockResolvedValue([]);
const mockGetSessionStagedDiff = vi.fn().mockResolvedValue("");
const mockGetSessionCommitsAhead = vi.fn().mockResolvedValue(0);
const mockGetSessionCommitsBehind = vi.fn().mockResolvedValue(0);
const mockMergeSessionIntoBase = vi.fn().mockResolvedValue(undefined);
const mockRebaseSessionOnBase = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/ipc", () => ({
  getSessionConflicts: (...args: unknown[]) => mockGetSessionConflicts(...args),
  getSessionStagedDiff: (...args: unknown[]) =>
    mockGetSessionStagedDiff(...args),
  getSessionCommitsAhead: (...args: unknown[]) =>
    mockGetSessionCommitsAhead(...args),
  getSessionCommitsBehind: (...args: unknown[]) =>
    mockGetSessionCommitsBehind(...args),
  mergeSessionIntoBase: (...args: unknown[]) =>
    mockMergeSessionIntoBase(...args),
  rebaseSessionOnBase: (...args: unknown[]) => mockRebaseSessionOnBase(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMergeStatus", () => {
  beforeEach(() => {
    eventListeners.clear();
    mockGetSessionConflicts.mockResolvedValue([]);
    mockGetSessionStagedDiff.mockResolvedValue("");
    mockGetSessionCommitsAhead.mockResolvedValue(0);
    mockGetSessionCommitsBehind.mockResolvedValue(0);
    mockMergeSessionIntoBase.mockResolvedValue(undefined);
    mockRebaseSessionOnBase.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns hasStaged true when staged diff is non-empty", async () => {
    mockGetSessionStagedDiff.mockResolvedValue("diff --git a/f.ts b/f.ts\n");

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(result.current.hasStaged).toBe(true);
    });
  });

  it("returns hasStaged false when staged diff is empty", async () => {
    mockGetSessionStagedDiff.mockResolvedValue("");

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(mockGetSessionStagedDiff).toHaveBeenCalled();
    });

    expect(result.current.hasStaged).toBe(false);
  });

  it("returns conflict list from getSessionConflicts", async () => {
    mockGetSessionConflicts.mockResolvedValue(["a.ts", "b.ts"]);

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(result.current.conflicts).toEqual(["a.ts", "b.ts"]);
    });
  });

  it("handleMerge calls mergeSessionIntoBase and returns true on success", async () => {
    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(mockGetSessionConflicts).toHaveBeenCalled();
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleMerge();
    });

    expect(mockMergeSessionIntoBase).toHaveBeenCalledWith("ws-1");
    expect(ok).toBe(true);
    expect(result.current.isMerging).toBe(false);
  });

  it("handleMerge returns false and records the error on failure", async () => {
    mockMergeSessionIntoBase.mockRejectedValue(
      new Error("merge conflict detected"),
    );

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(mockGetSessionConflicts).toHaveBeenCalled();
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleMerge();
    });

    expect(ok).toBe(false);
    expect(result.current.mergeError).toBe("merge conflict detected");
    expect(result.current.isMerging).toBe(false);
  });

  it("handleMerge returns false when sessionId is null", async () => {
    const { result } = renderHook(() => useMergeStatus(null));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleMerge();
    });

    expect(ok).toBe(false);
    expect(mockMergeSessionIntoBase).not.toHaveBeenCalled();
  });

  it("no-ops when sessionId is null", async () => {
    const { result } = renderHook(() => useMergeStatus(null));

    // Give it a tick to settle
    await act(async () => {});

    expect(mockGetSessionConflicts).not.toHaveBeenCalled();
    expect(mockGetSessionStagedDiff).not.toHaveBeenCalled();
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.hasStaged).toBe(false);
  });

  it("re-fetches status on session:diff-changed event", async () => {
    mockGetSessionStagedDiff.mockResolvedValue("");

    const { result } = renderHook(() => useMergeStatus("ws-1"));

    await waitFor(() => {
      expect(mockGetSessionStagedDiff).toHaveBeenCalledTimes(1);
    });

    // Now staged changes appear
    mockGetSessionStagedDiff.mockResolvedValue("some staged diff\n");

    act(() => {
      emitEvent("session:diff-changed:ws-1");
    });

    await waitFor(() => {
      expect(result.current.hasStaged).toBe(true);
    });
  });
});
