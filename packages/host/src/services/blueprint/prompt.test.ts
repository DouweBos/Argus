import type { Blueprint } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { buildBlueprintPrompt, renderBlueprintInstructions } from "./prompt";

const ctx = {
  name: "tally",
  description: "A menu bar counter",
  repoRoot: "/apps/tally",
  repoUrl: "https://github.com/me/tally",
};

const blueprint: Blueprint = {
  id: "b1",
  name: "Mac app",
  summary: "",
  parent_dir: "/apps",
  references: [
    { path: "/repos/argus", note: "release workflow and signing" },
    { path: "/repos/other", note: "" },
  ],
  scaffold: { kind: "empty" },
  github: { enabled: true, owner: "me", visibility: "private" },
  copy_project_settings_from: null,
  instructions:
    "Name it {{ name }}. {{description}} lives at {{path}}, pushed to {{repo}}. Keep {{other}}.",
  agent: { runner: null, model: null, permission_mode: null },
  created_at: 1,
  updated_at: 1,
};

describe("renderBlueprintInstructions", () => {
  it("fills the four placeholders and leaves the rest", () => {
    expect(renderBlueprintInstructions(blueprint.instructions, ctx)).toBe(
      "Name it tally. A menu bar counter lives at /apps/tally, pushed to https://github.com/me/tally. Keep {{other}}.",
    );
  });

  it("says when there is no repository", () => {
    expect(
      renderBlueprintInstructions("{{repo}}", { ...ctx, repoUrl: null }),
    ).toBe("(no GitHub repository)");
  });
});

describe("buildBlueprintPrompt", () => {
  it("assembles the brief", () => {
    const prompt = buildBlueprintPrompt(blueprint, ctx);
    expect(prompt).toContain("# New project: tally");
    expect(prompt).toContain("A menu bar counter");
    expect(prompt).toContain(
      "Its GitHub repository is https://github.com/me/tally.",
    );
    expect(prompt).toContain("Name it tally.");
    expect(prompt).toContain("- `/repos/argus` — release workflow and signing");
    expect(prompt).toContain("- `/repos/other`\n");
    expect(prompt.endsWith("push to origin.")).toBe(true);
  });

  it("does not ask for a push without a repository", () => {
    const prompt = buildBlueprintPrompt(blueprint, { ...ctx, repoUrl: null });
    expect(prompt).not.toContain("push to origin");
  });
});
