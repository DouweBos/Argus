import type { RemoteGitBranch } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  branchMenu,
  branchPrompt,
  branchRef,
  branchSections,
  branchStartPoints,
  filterBranches,
} from "./branches";
import {
  commitIdentityLabel,
  commitMessageText,
  hasCommitDescription,
  isCommitMessageEmpty,
  parseCommitMessage,
} from "./commitMessage";
import { changeSummary, pushLabel } from "./landWork";

function branch(
  name: string,
  over: Partial<RemoteGitBranch> = {},
): RemoteGitBranch {
  return {
    name,
    scope: "local",
    is_current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    ...over,
  };
}

// Vectors shared with ArgusCore's `CommitMessageTests`.
describe("commit message", () => {
  it("a summary alone is the whole message", () => {
    expect(
      commitMessageText({ summary: "  fix: a  ", description: " \n " }),
    ).toBe("fix: a");
  });

  it("a description follows a blank line", () => {
    const message = { summary: "feat: b", description: "\nWhy it matters.\n" };
    expect(commitMessageText(message)).toBe("feat: b\n\nWhy it matters.");
    expect(hasCommitDescription(message)).toBe(true);
  });

  it("a blank summary can't be committed, whatever the description says", () => {
    expect(isCommitMessageEmpty({ summary: " ", description: "body" })).toBe(
      true,
    );
  });

  it("parsing splits at the first line", () => {
    const parsed = parseCommitMessage("feat: c\n\nLine one\nLine two\n");
    expect(parsed.summary).toBe("feat: c");
    expect(parsed.description).toBe("Line one\nLine two");
    expect(parseCommitMessage("only\n").description).toBe("");
  });

  it("labels an identity", () => {
    expect(commitIdentityLabel({ name: "A", email: "a@b" })).toBe("A <a@b>");
    expect(commitIdentityLabel({ name: "", email: "a@b" })).toBe("a@b");
    expect(commitIdentityLabel({ name: "", email: "" })).toBeNull();
  });
});

describe("land work", () => {
  it("counts commits to push", () => {
    expect(pushLabel(0)).toBe("Push");
    expect(pushLabel(1)).toBe("Push 1 commit");
    expect(pushLabel(3)).toBe("Push 3 commits");
  });

  it("summarises the working tree", () => {
    expect(changeSummary({ dirty_count: 1 })).toBe("1 changed file");
    expect(
      changeSummary({ dirty_count: 2, diff_additions: 5, diff_deletions: 1 }),
    ).toBe("2 changed files · +5 −1");
  });
});

describe("branches", () => {
  const list = [
    branch("main", { is_current: true, upstream: "origin/main" }),
    branch("feature/x"),
    branch("release", { scope: "remote", remote: "origin" }),
  ];

  it("resolves remote-only refs and splits sections", () => {
    expect(branchRef(list[2])).toBe("origin/release");
    expect(
      branchSections(list).map((s) => [s.title, s.branches.length]),
    ).toEqual([
      ["Local", 2],
      ["Remote only", 1],
    ]);
    expect(filterBranches(list, " FEAT ").map((b) => b.name)).toEqual([
      "feature/x",
    ]);
  });

  it("lists start points, a missing preselection first", () => {
    expect(branchStartPoints(list, null)).toEqual([
      "main",
      "feature/x",
      "origin/release",
    ]);
    expect(branchStartPoints(list, "abc123")[0]).toBe("abc123");
  });

  it("offers the current branch push, pull and PR but no merge or delete", () => {
    const sections = branchMenu(list[0], { current: "main", canCompare: true });
    const labels = sections.flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toEqual([
      "Checked out",
      "New branch from main…",
      "Push",
      "Force push…",
      "Pull",
      "Open pull request",
      "Pin",
      "Rename…",
      "Copy name",
    ]);
    expect(sections[0].items[0].disabled).toBe(true);
  });

  it("offers another local branch merge, compare, publish and delete", () => {
    const labels = branchMenu(list[1], {
      current: "main",
      canCompare: true,
    }).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain("Merge into main");
    expect(labels).toContain("Compare with main");
    expect(labels).toContain("Publish");
    expect(labels).not.toContain("Open pull request");
    expect(labels.at(-1)).toBe("Delete…");
  });

  it("a remote-only branch checks out locally and can open a PR", () => {
    const labels = branchMenu(list[2], { current: null }).flatMap((s) =>
      s.items.map((i) => i.label),
    );
    expect(labels[0]).toBe("Check out locally");
    expect(labels).toContain("Merge into the current branch");
    expect(labels).toContain("Open pull request");
    expect(labels).not.toContain("Pin");
    expect(labels).not.toContain("Delete…");
  });

  it("words each confirmation", () => {
    expect(branchPrompt({ kind: "dirty" }, "x", "main").confirmLabel).toBe(
      "Stash & switch",
    );
    expect(
      branchPrompt({ kind: "delete", unmerged: true }, "x", "main").title,
    ).toBe("x isn't fully merged");
    expect(branchPrompt({ kind: "rebase" }, "x", "main").title).toBe(
      "Rebase main onto x?",
    );
  });
});
