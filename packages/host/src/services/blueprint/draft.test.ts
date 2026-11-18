import { describe, expect, it, vi } from "vitest";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { clip, githubSlug, sanitizeBlueprintDraft } = await import("./draft");

const origins = [
  {
    path: "/w/a",
    slug: "me/a",
    visibility: "public" as const,
    isTemplate: false,
  },
  {
    path: "/w/b",
    slug: "me/b",
    visibility: "private" as const,
    isTemplate: true,
  },
];

describe("clip", () => {
  it("cuts at a word boundary", () => {
    expect(clip("copy the asset catalog", 16)).toBe("copy the asset");
    expect(clip("  short   one ", 50)).toBe("short one");
  });
});

describe("githubSlug", () => {
  it("reads ssh and https remotes", () => {
    expect(githubSlug("git@github.com:me/app.git")).toBe("me/app");
    expect(githubSlug("https://github.com/me/app")).toBe("me/app");
    expect(githubSlug("https://gitlab.com/me/app")).toBeNull();
  });
});

describe("sanitizeBlueprintDraft", () => {
  it("keeps only the given projects and reads GitHub defaults from origin", () => {
    const draft = sanitizeBlueprintDraft(
      {
        name: "Mac app",
        summary: "SwiftUI",
        instructions: "Copy release.yml",
        references: [
          { path: "/w/a", note: "workflows" },
          { path: "/elsewhere", note: "nope" },
        ],
        copy_project_settings_from: "/w/b",
      },
      origins,
    );
    expect(draft).toEqual({
      name: "Mac app",
      summary: "SwiftUI",
      parent_dir: "/w",
      instructions: "Copy release.yml",
      scaffold: { kind: "github_template", repo: "me/b" },
      github: { enabled: true, owner: "me", visibility: "public" },
      references: [
        { path: "/w/a", note: "workflows" },
        { path: "/w/b", note: "" },
      ],
      copy_project_settings_from: "/w/b",
    });
  });

  it("rejects a reply without instructions", () => {
    expect(sanitizeBlueprintDraft({ name: "x" }, origins)).toBeNull();
  });

  it("falls back to the first project for settings", () => {
    const draft = sanitizeBlueprintDraft(
      { instructions: "x", copy_project_settings_from: "/nope" },
      [{ ...origins[0], isTemplate: false }],
    );
    expect(draft?.copy_project_settings_from).toBe("/w/a");
    expect(draft?.scaffold).toEqual({ kind: "empty" });
  });
});
