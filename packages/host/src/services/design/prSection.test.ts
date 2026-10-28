import { afterEach, describe, expect, it } from "vitest";
import { appState } from "../../state";
import { prReferenceSection } from "./prSection";

describe("prReferenceSection", () => {
  afterEach(() => appState.sessions.clear());

  it("names the ticket and the frames for a session's branch", () => {
    appState.sessions.set("s", {
      id: "s",
      kind: "worktree",
      branch: "eng-1",
      repo_root: "/repo",
      path: "/wt",
      description: "",
      status: "ready",
      linked_issue: {
        source: "linear",
        identifier: "ENG-1",
        title: "Login",
        url: "https://linear.app/a/issue/ENG-1",
      },
      design_refs: [
        {
          url: "https://figma.com/design/K?node-id=1-2",
          fileKey: "K",
          nodeId: "1:2",
          name: "Login",
        },
      ],
    });
    const section = prReferenceSection("/repo", "eng-1") ?? "";
    expect(section).toContain(
      "**Ticket:** [ENG-1 Login](https://linear.app/a/issue/ENG-1)",
    );
    expect(section).toContain(
      "**Design:** [Login](https://figma.com/design/K?node-id=1-2)",
    );
    expect(section).toContain("on the ticket");
  });

  it("adds nothing for a branch with no ticket or design", () => {
    expect(prReferenceSection("/repo", "other")).toBeNull();
  });
});
