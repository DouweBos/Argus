import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPullRequestUrl, pickPullRequestTemplate } from "./pullRequest";

let repoRoot: string;

function write(rel: string, content: string): void {
  const full = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

// ---------------------------------------------------------------------------
// buildPullRequestUrl
// ---------------------------------------------------------------------------

describe("buildPullRequestUrl", () => {
  it("returns a compare URL for github https remotes", () => {
    expect(
      buildPullRequestUrl("https://github.com/owner/repo.git", "feat", "main"),
    ).toBe("https://github.com/owner/repo/compare/main...feat?expand=1");
  });

  it("handles SSH remotes and strips the .git suffix", () => {
    expect(
      buildPullRequestUrl("git@github.com:acme/thing.git", "feat", "main"),
    ).toBe("https://github.com/acme/thing/compare/main...feat?expand=1");
  });

  it("returns null for non-github hosts", () => {
    expect(
      buildPullRequestUrl("git@gitlab.com:owner/repo.git", "feat", "main"),
    ).toBeNull();
  });

  it("appends ?template= when a template is provided", () => {
    expect(
      buildPullRequestUrl(
        "https://github.com/owner/repo",
        "feat",
        "main",
        "feature.md",
      ),
    ).toBe(
      "https://github.com/owner/repo/compare/main...feat?expand=1&template=feature.md",
    );
  });

  it("encodes template names with spaces", () => {
    expect(
      buildPullRequestUrl(
        "https://github.com/owner/repo",
        "feat",
        "main",
        "bug fix.md",
      ),
    ).toBe(
      "https://github.com/owner/repo/compare/main...feat?expand=1&template=bug%20fix.md",
    );
  });

  it("ignores blank template strings", () => {
    expect(
      buildPullRequestUrl(
        "https://github.com/owner/repo",
        "feat",
        "main",
        "   ",
      ),
    ).toBe("https://github.com/owner/repo/compare/main...feat?expand=1");
  });
});

// ---------------------------------------------------------------------------
// pickPullRequestTemplate
// ---------------------------------------------------------------------------

describe("pickPullRequestTemplate", () => {
  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-pr-template-"));
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns null when the repo has no templates", () => {
    expect(pickPullRequestTemplate(repoRoot)).toBeNull();
  });

  it("returns null for a single template at the canonical location (GitHub auto-applies)", () => {
    write(".github/PULL_REQUEST_TEMPLATE.md", "## Summary\n");
    expect(pickPullRequestTemplate(repoRoot)).toBeNull();
  });

  it("returns null for a single template at the repo root (GitHub auto-applies)", () => {
    write("PULL_REQUEST_TEMPLATE.md", "## Summary\n");
    expect(pickPullRequestTemplate(repoRoot)).toBeNull();
  });

  it("picks the first template alphabetically when multiple exist in .github/PULL_REQUEST_TEMPLATE/", () => {
    write(".github/PULL_REQUEST_TEMPLATE/bug.md", "bug");
    write(".github/PULL_REQUEST_TEMPLATE/feature.md", "feature");
    write(".github/PULL_REQUEST_TEMPLATE/chore.md", "chore");

    expect(pickPullRequestTemplate(repoRoot)).toBe("bug.md");
  });

  it("honors `.argus.json` pull_request_template override", () => {
    write(".github/PULL_REQUEST_TEMPLATE/bug.md", "bug");
    write(".github/PULL_REQUEST_TEMPLATE/feature.md", "feature");
    write(
      ".argus.json",
      JSON.stringify({ pull_request_template: "feature.md" }),
    );

    expect(pickPullRequestTemplate(repoRoot)).toBe("feature.md");
  });

  it("override wins even when no templates exist on disk (user knows what they want)", () => {
    write(
      ".argus.json",
      JSON.stringify({ pull_request_template: "custom.md" }),
    );

    expect(pickPullRequestTemplate(repoRoot)).toBe("custom.md");
  });

  it("ignores blank override strings", () => {
    write(".github/PULL_REQUEST_TEMPLATE/a.md", "a");
    write(".github/PULL_REQUEST_TEMPLATE/b.md", "b");
    write(".argus.json", JSON.stringify({ pull_request_template: "   " }));

    expect(pickPullRequestTemplate(repoRoot)).toBe("a.md");
  });

  it("ignores non-markdown files in the template directory", () => {
    write(".github/PULL_REQUEST_TEMPLATE/README.txt", "ignore me");
    write(".github/PULL_REQUEST_TEMPLATE/feature.md", "keep me");

    expect(pickPullRequestTemplate(repoRoot)).toBe("feature.md");
  });
});
