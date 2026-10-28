import { describe, expect, it } from "vitest";
import { designFileStem, startPrompt } from "./startPrompt";

const design = {
  url: "https://figma.com/design/K/App?node-id=1-2",
  fileKey: "K",
  nodeId: "1:2",
  name: "Login",
};

describe("startPrompt", () => {
  it("passes plain prompts through", () => {
    expect(startPrompt([], [], "  fix it ")).toBe("fix it");
  });

  it("orders issue, design, then the user's text", () => {
    const text = startPrompt(["## Linear issue ENG-1"], [design], "be careful");
    const issue = text.indexOf("ENG-1");
    const designs = text.indexOf("## Design");
    const ask = text.indexOf("be careful");
    expect(issue).toBeLessThan(designs);
    expect(designs).toBeLessThan(ask);
    expect(text).toContain(
      "- Login: https://figma.com/design/K/App?node-id=1-2",
    );
  });

  it("asks to work on the issue when nothing was typed", () => {
    expect(startPrompt(["## Linear issue ENG-1"], [], "")).toBe(
      "## Linear issue ENG-1\n\nWork on this issue.",
    );
  });

  it("adds no default ask for designs alone", () => {
    expect(
      startPrompt([], [design], "").endsWith(
        "which differences remain and why.",
      ),
    ).toBe(true);
  });

  it("points at the reference files in the worktree", () => {
    expect(startPrompt([], [design], "x")).toContain(
      "`.argus/design/login-1-2.png`",
    );
    expect(
      designFileStem({
        ...design,
        name: "Sign in / Error!",
        nodeId: "I1:2;3:4",
      }),
    ).toBe("sign-in-error-I1-2-3-4");
  });
});
