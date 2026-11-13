import type { AgentSession } from "./models";
import type { Session } from "../session/models";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { createCheckpoint, recordTurnEnd } from "./checkpoints";
import { listSessionTurns, sessionDiffRange } from "./turns";

const conversations = vi.hoisted(
  () => new Map<string, { messages: unknown[] }>(),
);

vi.mock("./conversation/live", () => ({
  readConversation: (id: string) => conversations.get(id) ?? null,
}));
vi.mock("./chatHistory", () => ({
  loadHistoryIndex: () => [],
  loadConversation: () => null,
}));

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env });
}

function write(name: string, text: string): void {
  fs.writeFileSync(path.join(repo, name), text, "utf8");
}

function changed(range: { from: string; to: string }): string[] {
  return git(["diff", "--name-only", range.from, range.to])
    .split("\n")
    .filter(Boolean);
}

let tmp: string;
let repo: string;

function prompt(checkpointId: string, text: string, timestamp: number) {
  return { role: "user", checkpointId, textBlocks: [text], timestamp };
}

// Real git, a dozen commands per test.
describe("turn-scoped diffs", { timeout: 30_000 }, () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-turns-")),
    );
    repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    git(["init", "-q", "-b", "main", "."]);
    write(".gitignore", "ignored.txt\n");
    write("a.txt", "a\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);
    git(["checkout", "-qb", "feature"]);
    appState.sessions.set("s1", {
      id: "s1",
      kind: "worktree",
      path: repo,
      repo_root: repo,
      base_branch: "main",
    } as Session);
    appState.agents.set("a1", {
      agentId: "a1",
      sessionId: "s1",
    } as AgentSession);
  });

  afterEach(() => {
    appState.sessions.delete("s1");
    appState.agents.delete("a1");
    conversations.clear();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("scopes each turn to what its prompt changed", async () => {
    write("before.txt", "from an earlier turn\n");
    const one = await createCheckpoint("s1");
    write("one.txt", "turn one\n");
    await recordTurnEnd("s1", one.id);
    // Between turns, outside any prompt: in neither turn.
    write("between.txt", "the user\n");
    const two = await createCheckpoint("s1");
    write("a.txt", "a\nturn two\n");
    conversations.set("a1", {
      messages: [
        prompt(one.id, "Add one\nmore detail", 1),
        { role: "assistant", textBlocks: [], timestamp: 2 },
        prompt(two.id, "Change a", 3),
      ],
    });

    const turns = await listSessionTurns("s1");
    expect(turns.map((t) => [t.number, t.prompt])).toEqual([
      [1, "Add one"],
      [2, "Change a"],
    ]);
    expect(
      changed(
        await sessionDiffRange("s1", { kind: "turn", checkpointId: one.id }),
      ),
    ).toEqual(["one.txt"]);
    // The latest turn is still running: it ends at the tree as it is now.
    expect(changed(await sessionDiffRange("s1", { kind: "turn" }))).toEqual([
      "a.txt",
    ]);
    expect(changed(await sessionDiffRange("s1", { kind: "branch" }))).toEqual([
      "a.txt",
      "before.txt",
      "between.txt",
      "one.txt",
    ]);
  });

  it("skips turns whose checkpoint ref is gone", async () => {
    conversations.set("a1", { messages: [prompt("missing", "Gone", 1)] });

    await expect(listSessionTurns("s1")).resolves.toEqual([]);
    await expect(sessionDiffRange("s1", { kind: "turn" })).rejects.toBe(
      "No agent turns yet",
    );
  });
});
