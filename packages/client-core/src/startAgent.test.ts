import { describe, expect, it } from "vitest";
import {
  canStart,
  initialWorkspace,
  spawnableMode,
  type StartDraft,
  workspaceOptions,
  worktreeParams,
} from "./startAgent";

const draft = (partial: Partial<StartDraft> = {}): StartDraft => ({
  workspace: "worktree",
  message: "fix it",
  displayText: "fix it",
  images: [],
  model: null,
  permissionMode: null,
  effort: null,
  runnerId: null,
  baseBranch: "main",
  existingBranch: null,
  ...partial,
});

const both = { sessionId: "s", repoRoot: "/r" };

describe("start workspace", () => {
  it("offers what the context allows", () => {
    expect(workspaceOptions(both)).toEqual(["current", "worktree", "existing"]);
    expect(workspaceOptions({ sessionId: null, repoRoot: "/r" })).toEqual([
      "worktree",
      "existing",
    ]);
    expect(workspaceOptions({ sessionId: "s", repoRoot: null })).toEqual([
      "current",
    ]);
  });

  it("opens on what the context allows", () => {
    expect(
      initialWorkspace({ sessionId: null, repoRoot: "/r" }, "current"),
    ).toBe("worktree");
    expect(
      initialWorkspace({ sessionId: "s", repoRoot: null }, "worktree"),
    ).toBe("current");
    expect(initialWorkspace(both, "worktree")).toBe("worktree");
  });

  it("needs words for a worktree, a branch for an existing one", () => {
    expect(canStart(draft({ displayText: " " }), both)).toBe(false);
    expect(
      canStart(
        draft({
          workspace: "current",
          displayText: "",
          images: [{ data: "", media_type: "image/png" }],
        }),
        both,
      ),
    ).toBe(true);
    expect(
      canStart(draft({ workspace: "existing", displayText: "" }), both),
    ).toBe(false);
    expect(
      canStart(draft({ workspace: "existing", existingBranch: "topic" }), both),
    ).toBe(true);
  });
});

describe("worktree params", () => {
  it("lets the host start a text-only agent", () => {
    expect(worktreeParams(draft({ model: "haiku" }), "/r")).toEqual({
      repo_root: "/r",
      branch: "",
      description: "fix it",
      base_branch: "main",
      prompt: "fix it",
      model: "haiku",
    });
  });

  it("starts the agent itself when images or effort ride along", () => {
    expect(
      worktreeParams(draft({ effort: "high" }), "/r").prompt,
    ).toBeUndefined();
  });

  it("checks out an existing branch instead of forking a base", () => {
    const params = worktreeParams(
      draft({ workspace: "existing", existingBranch: "topic" }),
      "/r",
    );
    expect(params).toMatchObject({
      branch: "topic",
      use_existing_branch: true,
    });
    expect(params.base_branch).toBeUndefined();
  });

  it("only spawns modes the gateway accepts", () => {
    expect(spawnableMode("plan")).toBe("plan");
    expect(spawnableMode("trusted")).toBeNull();
  });
});
