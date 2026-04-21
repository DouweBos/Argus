import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { branchToDir, titleToBranchSlug, worktreesRoot } from "./git";

describe("branchToDir", () => {
  it("replaces forward slashes", () => {
    expect(branchToDir("feature/auth")).toBe("feature_auth");
  });

  it("replaces backslashes", () => {
    expect(branchToDir("feature\\auth")).toBe("feature_auth");
  });

  it("replaces spaces", () => {
    expect(branchToDir("my branch")).toBe("my_branch");
  });

  it("replaces special characters", () => {
    expect(branchToDir('a:b*c?"d<e>f|g')).toBe("a_b_c__d_e_f_g");
  });

  it("passes through clean branch names", () => {
    expect(branchToDir("main")).toBe("main");
    expect(branchToDir("fix-123")).toBe("fix-123");
  });

  it("handles nested feature branches", () => {
    expect(branchToDir("feature/auth/oauth2")).toBe("feature_auth_oauth2");
  });
});

describe("titleToBranchSlug", () => {
  it("converts spaces to hyphens and lowercases", () => {
    expect(titleToBranchSlug("Fix Auth Bug")).toBe("fix-auth-bug");
  });

  it("strips special git-invalid characters", () => {
    expect(titleToBranchSlug("Feat: Auth (v2)")).toBe("feat-auth-v2");
  });

  it("collapses multiple separators", () => {
    expect(titleToBranchSlug("a   b---c")).toBe("a-b-c");
  });

  it("trims leading/trailing separators", () => {
    expect(titleToBranchSlug("  Hello World  ")).toBe("hello-world");
  });

  it("returns 'session' for empty input", () => {
    expect(titleToBranchSlug("")).toBe("session");
    expect(titleToBranchSlug("   ")).toBe("session");
  });

  it("preserves forward slashes for branch paths", () => {
    expect(titleToBranchSlug("feature/new-thing")).toBe("feature/new-thing");
  });

  it("handles emoji and unicode", () => {
    const result = titleToBranchSlug("Fix bug");
    expect(result).toBe("fix-bug");
  });

  it("truncates long slugs at a word boundary", () => {
    const long =
      "when creating a new session in the session dialog the start session button hangs probably on the branch name";
    const result = titleToBranchSlug(long);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).not.toMatch(/-$/);
    expect(result).toBe("when-creating-a-new-session-in-the-session-dialog");
  });
});

describe("worktreesRoot", () => {
  it("computes correct path for a repo", () => {
    const result = worktreesRoot("/home/user/Projects/MyApp");
    expect(result).toBe(
      path.join(os.homedir(), ".argus", "worktrees", "MyApp-argus-worktrees"),
    );
  });

  it("uses 'repo' as fallback for root path", () => {
    const result = worktreesRoot("/");
    expect(result).toBe(
      path.join(os.homedir(), ".argus", "worktrees", "repo-argus-worktrees"),
    );
  });
});
