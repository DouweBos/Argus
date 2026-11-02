// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BrowserScreen, { NO_BROWSER_TIMEOUT_MS } from "./BrowserScreen";

const request = vi.fn(async (method: string) =>
  method === "browser.watch" ? { stream_id: 7 } : { accepted: true },
);
const unregister = vi.fn();
const register = vi.fn((_streamId: number, _sink: unknown) => unregister);

vi.mock("../stores/connection", () => ({
  currentTransport: () => ({ request }),
  media: {
    register: (streamId: number, sink: unknown) => register(streamId, sink),
  },
  useConnectionStore: (select: (s: unknown) => unknown) =>
    select({ connection: "ready" }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  request.mockClear();
  register.mockClear();
  unregister.mockClear();
});

afterEach(() => vi.useRealTimers());

describe("a session's browser", () => {
  it("watches the session's browser and lets go on the way out", async () => {
    const { unmount } = render(<BrowserScreen sessionId="s1" />);
    await act(async () => {});

    expect(request).toHaveBeenCalledWith("browser.watch", { session_id: "s1" });
    expect(register).toHaveBeenCalledWith(7, expect.any(Function));

    unmount();

    expect(unregister).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("browser.unwatch", {
      session_id: "s1",
    });
  });

  it("says there is no browser when no frame arrives", async () => {
    render(<BrowserScreen sessionId="s1" />);
    await act(async () => {});
    expect(screen.queryByText("No browser open in this session")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(NO_BROWSER_TIMEOUT_MS);
    });

    expect(screen.getByText("No browser open in this session")).toBeTruthy();
  });
});
