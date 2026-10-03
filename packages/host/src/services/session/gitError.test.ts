import { describe, expect, it } from "vitest";
import { classifyGitStderr } from "./gitError";

describe("classifyGitStderr", () => {
  it("reads git's conflict lines as a paused merge", () => {
    const err = classifyGitStderr(
      "Auto-merging a.txt\nCONFLICT (content): Merge conflict in a.txt\nAutomatic merge failed; fix conflicts and then commit the result.",
    );
    expect(err.kind).toBe("merge-conflict");
  });

  it("names a rebase stop from the op hint", () => {
    const err = classifyGitStderr(
      "error: could not apply 1234567... x\nhint: Resolve all conflicts manually",
      { op: "rebase" },
    );
    expect(err.kind).toBe("rebase-conflict");
  });

  it("doesn't call a failure a conflict because a ref or file is named so", () => {
    const err = classifyGitStderr(
      "error: pathspec 'conflict-b' did not match any file(s) known to git",
    );
    expect(err.kind).not.toBe("merge-conflict");
    const dirty = classifyGitStderr(
      "error: Your local changes to the following files would be overwritten by checkout:\n\tconflict.txt\nPlease commit your changes or stash them before you switch branches.",
    );
    expect(dirty.kind).not.toBe("merge-conflict");
  });
});
