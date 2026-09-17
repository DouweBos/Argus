/**
 * Overflowing `maxBuffer` rejects with `ENOBUFS` and *no stderr*, so without an
 * explicit branch it falls through to `classifyGitStderr` and surfaces as a
 * generic failure — which reads as "the diff is broken" rather than "too big".
 */

import { describe, expect, it, vi } from "vitest";

type ExecCallback = (
  err: unknown,
  out: { stdout: string; stderr: string },
) => void;

const behaviour = { overflow: false };

vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: ExecCallback,
  ) => {
    if (behaviour.overflow) {
      cb(
        Object.assign(new Error("stdout maxBuffer length exceeded"), {
          code: "ENOBUFS",
        }),
        { stdout: "", stderr: "" },
      );

      return;
    }
    cb(null, { stdout: "ok\n", stderr: "" });
  },
}));

const { git } = await import("./git");
const { GitError } = await import("./gitError");

describe("git output ceiling", () => {
  it("reports an overflow as output-too-large, not a generic git failure", async () => {
    behaviour.overflow = true;
    const err = await git("/repo", ["diff"]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GitError);
    expect((err as InstanceType<typeof GitError>).kind).toBe(
      "output-too-large",
    );
    // The message must name the size problem — the whole point of the branch.
    expect((err as Error).message).toMatch(/more output/);
    expect((err as InstanceType<typeof GitError>).recovery).toBeTruthy();
  });

  it("leaves ordinary git output alone", async () => {
    behaviour.overflow = false;

    await expect(git("/repo", ["diff"])).resolves.toBe("ok\n");
  });
});
