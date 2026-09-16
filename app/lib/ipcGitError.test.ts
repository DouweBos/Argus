/**
 * A git failure on a paired host must arrive as a typed GitError. The gateway
 * flattens errors to `{code, message}`, so the envelope rides in the message
 * behind a tag; this checks it is unpacked and the tag never reaches the UI.
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

const TAG = "\u0000argus-git-error:";

function rejectsWith(message: string): void {
  invokeMock.mockRejectedValue(new Error(message));
}

describe("git errors over the wire", () => {
  beforeEach(() => {
    // Returning the mock would make vitest treat it as a teardown callback.
    invokeMock.mockReset();
  });

  it("rehydrates the structured payload from a flattened remote error", async () => {
    const envelope = JSON.stringify({
      __gitError: true,
      kind: "no-upstream",
      message: "Branch has no upstream configured",
      recovery: "publish-branch",
      stderr: "fatal: no upstream branch",
    });
    rejectsWith(`Branch has no upstream configured${TAG}${envelope}`);

    const err = (await gitPush("s1").catch(
      (e: unknown) => e,
    )) as GitErrorInstance;
    expect(err).toBeInstanceOf(GitError);
    expect(err.kind).toBe("no-upstream");
    expect(err.recovery).toBe("publish-branch");
    expect(err.stderr).toBe("fatal: no upstream branch");
    expect(err.message).toBe("Branch has no upstream configured");
  });

  it("strips the tag even when the envelope is unreadable", async () => {
    rejectsWith(`push failed${TAG}{truncated`);

    const err = (await gitPush("s1").catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("push failed");
  });

  it("leaves ordinary errors alone", async () => {
    rejectsWith("boom");

    const err = (await gitPush("s1").catch((e: unknown) => e)) as Error;
    expect(err.message).toBe("boom");
  });
});
