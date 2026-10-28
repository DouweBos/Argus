import type { LinearIssueContext } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { issueStartPrompt } from "./issueStart";

const context = { context: "## ENG-1: Fix login" } as LinearIssueContext;

describe("issueStartPrompt", () => {
  it("asks for the issue when the user typed nothing", () => {
    expect(issueStartPrompt(context, [], "  ")).toBe(
      "## ENG-1: Fix login\n\nWork on this issue.",
    );
  });

  it("puts the designs between the issue and the user's words", () => {
    const prompt = issueStartPrompt(
      context,
      [
        {
          url: "https://figma.com/design/k",
          fileKey: "k",
          nodeId: null,
          name: "Login",
        },
      ],
      "Keep it small",
    );
    expect(prompt.startsWith("## ENG-1: Fix login\n\n## Design")).toBe(true);
    expect(prompt).toContain("- Login: https://figma.com/design/k");
    expect(prompt.endsWith("\n\nKeep it small")).toBe(true);
  });
});
