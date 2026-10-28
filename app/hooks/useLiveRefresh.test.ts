// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveRefresh } from "./useLiveRefresh";

describe("useLiveRefresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refreshes on every interval while mounted, and stops after unmount", () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useLiveRefresh(refresh, 60_000));
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    unmount();
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("refreshes when the window regains focus or becomes visible", () => {
    const refresh = vi.fn();
    renderHook(() => useLiveRefresh(refresh, 60_000));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("calls the latest callback without restarting the timer", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => useLiveRefresh(fn, 60_000), {
      initialProps: { fn: first },
    });
    vi.advanceTimersByTime(30_000);
    rerender({ fn: second });
    vi.advanceTimersByTime(30_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
