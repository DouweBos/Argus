import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeProjectSlug, findClaudeTranscript } from "./transcriptFork";

const ID = "conversation-1";
let projects: string;

function transcript(dir: string, modifiedSecond: number): string {
  const file = path.join(projects, dir, `${ID}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{}\n");
  fs.utimesSync(file, modifiedSecond, modifiedSecond);

  return file;
}

describe("findClaudeTranscript", () => {
  beforeEach(() => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-find-"));
    vi.stubEnv("HOME", home);
    projects = path.join(home, ".claude", "projects");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes the one under the cwd", () => {
    const here = transcript(claudeProjectSlug("/repo"), 100);
    transcript("-elsewhere", 200);

    expect(findClaudeTranscript("/repo", ID)).toBe(here);
  });

  it("finds one the chat left elsewhere", () => {
    const there = transcript("-elsewhere", 100);

    expect(findClaudeTranscript("/repo", ID)).toBe(there);
  });

  it("reads the live one of a long cwd, not a resume's stale copy", () => {
    const cwd = `/${"nested/".repeat(33)}repo`;
    const slug = claudeProjectSlug(cwd);
    transcript(slug, 100);
    const live = transcript(`${slug.slice(0, 200)}-hjkhwv`, 200);

    expect(findClaudeTranscript(cwd, ID)).toBe(live);
  });

  it("has none to find", () => {
    expect(findClaudeTranscript("/repo", ID)).toBeNull();
  });
});
