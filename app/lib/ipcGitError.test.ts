/**
 * A git failure on a paired host must arrive as a typed GitError. The gateway
 * carries the envelope in the wire error's `data` field; local IPC keeps it as
 * own props on the thrown Error. Both must rehydrate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("./transport", () => ({
  getTransport: () => ({ invoke: invokeMock, on: vi.fn(), send: vi.fn() }),
  isRemoteMode: () => true,
}));

const { gitPush } = await import("./ipc");
const { GitError } = await import("./gitError");
type GitErrorInstance = InstanceType<typeof GitError>;

const ENVELOPE = {
  __gitError: true,
  kind: "no-upstream",
  message: "Branch has no upstream configured",
  recovery: "publish-branch",
  stderr: "fatal: no upstream branch",
};

function rehydrated(err: unknown): Record<string, unknown> {
  const e = err as GitErrorInstance;

  return {
    isGitError: e instanceof GitError,
    kind: e.kind,
    recovery: e.recovery,
    stderr: e.stderr,
    message: e.message,
  };
}

const REHYDRATED = {
  isGitError: true,
  kind: "no-upstream",
  recovery: "publish-branch",
  stderr: "fatal: no upstream branch",
  message: "Branch has no upstream configured",
};

describe("git errors over the wire", () => {
  beforeEach(() => {
    // Returning the mock would make vitest treat it as a teardown callback.
    invokeMock.mockReset();
  });

  it("rehydrates the payload a remote error carries in `data`", async () => {
    const remote = Object.assign(
      new Error("Branch has no upstream configured"),
      { code: "bad_request", data: ENVELOPE },
    );
    invokeMock.mockRejectedValue(remote);

    expect(rehydrated(await gitPush("s1").catch((e: unknown) => e))).toEqual(
      REHYDRATED,
    );
  });

  it("rehydrates the own props local IPC preserves", async () => {
    const local = Object.assign(
      new Error("Branch has no upstream configured"),
      ENVELOPE,
    );
    invokeMock.mockRejectedValue(local);

    expect(rehydrated(await gitPush("s1").catch((e: unknown) => e))).toEqual(
      REHYDRATED,
    );
  });

  it("leaves an error with unreadable data alone", async () => {
    invokeMock.mockRejectedValue(
      Object.assign(new Error("push failed"), { data: "{truncated" }),
    );

    const err = (await gitPush("s1").catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("push failed");
  });

  it("leaves ordinary errors alone", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));

    const err = (await gitPush("s1").catch((e: unknown) => e)) as Error;
    expect(err.message).toBe("boom");
  });
});
