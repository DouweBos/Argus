import type { AgentSession } from "./models";
import type { Session } from "../session/models";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { createCheckpoint, recordTurnEnd } from "./checkpoints";
import {
  getSessionTimeline,
  restoreToTurnEnd,
  undoTurnRestore,
} from "./timeline";

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

let tmp: string;
let repo: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env });
}

function write(name: string, text: string): void {
  fs.writeFileSync(path.join(repo, name), text, "utf8");
}

function read(name: string): string | null {
  const file = path.join(repo, name);

  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function prompt(checkpointId: string, text: string, timestamp: number) {
  return { role: "user", checkpointId, textBlocks: [text], timestamp };
}

/** Two finished turns: one adds an untracked file, two edits a tracked one. */
async function twoTurns(): Promise<{ one: string; two: string }> {
  const one = await createCheckpoint("s1");
  write("one.txt", "turn one\n");
  await recordTurnEnd("s1", one.id);
  const two = await createCheckpoint("s1");
  write("a.txt", "a\nturn two\nmore\n");
  write("two.txt", "turn two\n");
  await recordTurnEnd("s1", two.id);
  conversations.set("a1", {
    messages: [
      prompt("gone", "Lost to a prune", 1),
      prompt(one.id, "Add one", 2),
      prompt(two.id, "Change a", 3),
    ],
  });

  return { one: one.id, two: two.id };
}

// Real git, a dozen commands per test.
describe("session timeline", { timeout: 30_000 }, () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-timeline-")),
    );
    repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    git(["init", "-q", "-b", "main", "."]);
    write(".gitignore", "ignored.txt\n");
    write("a.txt", "a\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);
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
      status: "idle",
      inflightPrompts: 0,
    } as AgentSession);
  });

  afterEach(() => {
    appState.sessions.delete("s1");
    appState.agents.delete("a1");
    conversations.clear();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lists every turn with its stats, keeping a gone one's number", async () => {
    await twoTurns();

    const { turns, restores, busy } = await getSessionTimeline("s1");

    expect(
      turns.map((t) => [t.number, t.prompt, t.available, t.files]),
    ).toEqual([
      [1, "Lost to a prune", false, 0],
      [2, "Add one", true, 1],
      [3, "Change a", true, 2],
    ]);
    expect(turns[2]).toMatchObject({ additions: 3, deletions: 0 });
    expect(restores).toEqual([]);
    expect(busy).toBe(false);
  });

  it("restores the files to a turn's end, untracked ones included, and undoes it", async () => {
    const { one } = await twoTurns();
    write("ignored.txt", "kept\n");
    write("later.txt", "after the turns\n");

    const restore = await restoreToTurnEnd("s1", one);

    expect(read("one.txt")).toBe("turn one\n");
    expect(read("a.txt")).toBe("a\n");
    expect(read("two.txt")).toBeNull();
    expect(read("later.txt")).toBeNull();
    expect(read("ignored.txt")).toBe("kept\n");
    // Untracked stays untracked: the index is HEAD's.
    expect(git(["status", "--porcelain"])).toBe("?? one.txt\n");
    expect(restore).toMatchObject({ turnNumber: 2, canUndo: true });
    const timeline = await getSessionTimeline("s1");
    expect(timeline.restores).toMatchObject([
      { id: restore.id, undoneAt: null },
    ]);

    await undoTurnRestore("s1", restore.id);

    expect(read("a.txt")).toBe("a\nturn two\nmore\n");
    expect(read("two.txt")).toBe("turn two\n");
    expect(read("later.txt")).toBe("after the turns\n");
    expect(read("ignored.txt")).toBe("kept\n");
    expect(git(["status", "--porcelain"]).split("\n").sort()).toEqual([
      "",
      " M a.txt",
      "?? later.txt",
      "?? one.txt",
      "?? two.txt",
    ]);
    const after = await getSessionTimeline("s1");
    expect(after.restores[0]?.undoneAt).toEqual(expect.any(Number));
    expect(after.restores[0]?.canUndo).toBe(false);
    await expect(undoTurnRestore("s1", restore.id)).rejects.toBe(
      "That restore was already undone",
    );
  });

  it("only undoes the latest restore", async () => {
    const { one, two } = await twoTurns();
    const first = await restoreToTurnEnd("s1", one);
    await restoreToTurnEnd("s1", two);

    await expect(undoTurnRestore("s1", first.id)).rejects.toBe(
      "Only the latest restore can be undone",
    );
    expect(
      (await getSessionTimeline("s1")).restores.map((r) => r.canUndo),
    ).toEqual([false, true]);
  });

  it("won't undo once a turn has started after the restore", async () => {
    const { one } = await twoTurns();
    const restore = await restoreToTurnEnd("s1", one);
    const three = await createCheckpoint("s1");
    conversations
      .get("a1")!
      .messages.push(prompt(three.id, "Again", Date.now() + 1));

    expect((await getSessionTimeline("s1")).restores[0]?.canUndo).toBe(false);
    await expect(undoTurnRestore("s1", restore.id)).rejects.toMatch(
      /has worked since/,
    );
  });

  it("refuses while an agent in the session is working", async () => {
    const { one } = await twoTurns();
    appState.agents.get("a1")!.status = "running";

    await expect(restoreToTurnEnd("s1", one)).rejects.toMatch(/still working/);
    expect(read("two.txt")).toBe("turn two\n");
    expect((await getSessionTimeline("s1")).busy).toBe(true);
  });

  it("refuses a gone turn and one that hasn't finished", async () => {
    const one = await createCheckpoint("s1");
    write("one.txt", "running\n");
    conversations.set("a1", {
      messages: [prompt("gone", "Gone", 1), prompt(one.id, "Running", 2)],
    });

    await expect(restoreToTurnEnd("s1", "gone")).rejects.toBe(
      "That turn's checkpoint is gone",
    );
    await expect(restoreToTurnEnd("s1", one.id)).rejects.toBe(
      "That turn hasn't finished yet",
    );
    const { turns } = await getSessionTimeline("s1");
    expect(turns[1]).toMatchObject({ finished: false, files: 1 });
  });
});
