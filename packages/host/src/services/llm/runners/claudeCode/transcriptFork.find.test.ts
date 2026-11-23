import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claudeProjectSlug,
  ensureClaudeTranscriptAt,
  findClaudeTranscript,
  forkClaudeSessionFile,
} from "./transcriptFork";

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

  it("reads the live one of a long cwd, not an older Argus's stale copy", () => {
    const cwd = `/${"nested/".repeat(33)}repo`;
    transcript(cwd.replace(/[^a-zA-Z0-9]/g, "-"), 300);
    const live = transcript(claudeProjectSlug(cwd), 200);

    expect(findClaudeTranscript(cwd, ID)).toBe(live);
  });

  it("has none to find", () => {
    expect(findClaudeTranscript("/repo", ID)).toBeNull();
  });
});

describe("a long cwd's project dir", () => {
  // The CLI's own name for this dir, read off a real run.
  const cwd =
    "/private/tmp/argus-501-de2c6c5f/041411ea-25d1-4fc7-b23f-243e4709bbf0/claude-501/-Users-douwe--argus-worktrees-Argus-argus-worktrees-pause-idle-agents-resume-on-send/02c4dbcc-405a-42dc-b4ec-7b26ba200eee/scratchpad/probe-cwd";
  const cliDir = `${cwd.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 200)}-hjkhwv`;

  beforeEach(() => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-slug-"));
    vi.stubEnv("HOME", home);
    projects = path.join(home, ".claude", "projects");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is named as the CLI names it", () => {
    expect(claudeProjectSlug(cwd)).toBe(cliDir);
    expect(claudeProjectSlug("/short/path")).toBe("-short-path");
  });

  it("gets a resume's copy where the CLI looks", () => {
    transcript("-elsewhere", 100);

    ensureClaudeTranscriptAt(cwd, ID);

    expect(fs.readdirSync(projects).sort()).toEqual(
      [cliDir, "-elsewhere"].sort(),
    );
  });

  it("gets a fork where the CLI looks", async () => {
    const source = path.join(projects, "-src", `${ID}.jsonl`);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(
      source,
      `${JSON.stringify({ type: "user", uuid: "u1", timestamp: new Date(0).toISOString(), message: { content: [{ type: "text", text: "hi" }] } })}\n`,
    );

    const forked = await forkClaudeSessionFile({
      sourceCwd: "/src",
      sourceSessionId: ID,
      destCwd: cwd,
      destBranch: "b",
      forkTimestampMs: Date.now(),
      forkTurnNumber: 1,
    });

    expect(forked).not.toBeNull();
    expect(fs.existsSync(path.join(projects, cliDir, `${forked}.jsonl`))).toBe(
      true,
    );
  });
});
