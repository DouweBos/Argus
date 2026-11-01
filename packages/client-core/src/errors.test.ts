import { describe, expect, it } from "vitest";
import {
  describeError,
  isQuietError,
  isTransientError,
  NOT_CONNECTED_MESSAGE,
  TIMED_OUT_MESSAGE,
} from "./errors";

/** Shaped like `@argus/remote-client`'s `RemoteError`. */
function remote(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe("transient errors", () => {
  it("are the connection's failures, not the host's", () => {
    expect(isTransientError(remote("offline"))).toBe(true);
    expect(isTransientError(remote("timeout"))).toBe(true);
    expect(isTransientError(remote("disconnected"))).toBe(true);
    expect(isTransientError(remote("capability_denied"))).toBe(false);
    expect(isTransientError(new Error("boom"))).toBe(false);
    expect(isTransientError("offline")).toBe(false);
  });

  it("are only quiet in a background refresh", () => {
    expect(isQuietError(remote("offline"), true)).toBe(true);
    expect(isQuietError(remote("offline"), false)).toBe(false);
    expect(isQuietError(remote("not_found"), true)).toBe(false);
  });
});

describe("describeError", () => {
  it("speaks the phone's words for a dropped connection", () => {
    expect(describeError(remote("offline"))).toBe(NOT_CONNECTED_MESSAGE);
    expect(describeError(remote("disconnected"))).toBe(NOT_CONNECTED_MESSAGE);
    expect(describeError(remote("timeout"))).toBe(TIMED_OUT_MESSAGE);
  });

  it("passes the host's message through", () => {
    expect(describeError(remote("not_found", "No such session"))).toBe(
      "No such session",
    );
    expect(describeError("plain")).toBe("plain");
    expect(describeError(null)).toBe("Something went wrong.");
  });
});
