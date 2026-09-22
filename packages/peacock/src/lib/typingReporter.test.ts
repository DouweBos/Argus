/**
 * The throttle a composer leans on: every keystroke calls in, but the wire
 * sees a flag raised once and renewed slowly, then dropped when they stop.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTypingReporter } from "./typingReporter";

describe("the typing reporter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("raises the flag once, however fast they type", () => {
    const send = vi.fn();
    const reporter = createTypingReporter(send);
    reporter.keystroke();
    reporter.keystroke();
    reporter.keystroke();

    expect(send.mock.calls).toEqual([[true]]);
  });

  it("renews while they keep going, well inside the host's expiry", () => {
    const send = vi.fn();
    const reporter = createTypingReporter(send);
    reporter.keystroke();
    vi.advanceTimersByTime(2_000);
    reporter.keystroke();

    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_500);
    reporter.keystroke();

    expect(send.mock.calls).toEqual([[true], [true]]);
  });

  it("drops the flag once the keyboard goes quiet", () => {
    const send = vi.fn();
    createTypingReporter(send).keystroke();
    vi.advanceTimersByTime(3_000);

    expect(send.mock.calls).toEqual([[true], [false]]);
  });

  it("drops it immediately on send, and not twice", () => {
    const send = vi.fn();
    const reporter = createTypingReporter(send);
    reporter.keystroke();
    reporter.stop();
    reporter.stop();

    expect(send.mock.calls).toEqual([[true], [false]]);
  });

  it("says nothing when they never started", () => {
    const send = vi.fn();
    createTypingReporter(send).stop();

    expect(send).not.toHaveBeenCalled();
  });
});
