import type { Session } from "../../session/models";
import type { LlmStreamEvent } from "../conversation/types";
import type { AgentSession } from "../models";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appState } from "../../../state";
import {
  getLineAttribution,
  noteHumanWrite,
  noteTurnEnded,
  noteTurnStarted,
  observeAttributionEvent,
  resetLineAttribution,
  settledLineAttribution,
} from "./attribution";
import { matchLines } from "./lineDiff";
import { reconcile, splitLines, toRanges, unattributed } from "./lines";
import { agentEdits } from "./toolCalls";

describe("matchLines", () => {
  it("pairs every unchanged line across an insertion and a deletion", () => {
    const map = matchLines(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"]);

    expect([...map]).toEqual([0, -1, 2, 3, -1]);
  });

  it("finds the common lines in a reordered middle", () => {
    const map = matchLines(
      ["1", "a", "b", "c", "9"],
      ["1", "c", "a", "b", "9"],
    );

    expect([...map]).toEqual([0, -1, 1, 2, 4]);
  });

  it("only pairs equal lines, in order, after random edits", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 50; round++) {
      const a = Array.from({ length: 40 }, () =>
        String(Math.floor(random() * 8)),
      );
      const b = a.flatMap((line) => {
        if (random() < 0.2) {
          return [];
        }

        return random() < 0.2 ? [line, "new"] : [line];
      });
      const map = matchLines(a, b);
      const pairs = [...map].flatMap((old, i) =>
        old >= 0 ? [[old, i] as const] : [],
      );
      expect(pairs.every(([old, i]) => a[old] === b[i])).toBe(true);
      expect(pairs.every(([old], k) => k === 0 || old > pairs[k - 1]![0])).toBe(
        true,
      );
      expect(pairs).toHaveLength(b.filter((l) => l !== "new").length);
    }
  });
});

describe("reconcile", () => {
  const agent = () => "agent" as const;
  const human = () => "human" as const;

  it("shifts marked ranges when lines are inserted or deleted above them", () => {
    const base = unattributed(["one", "two"]);
    const written = reconcile(base, ["one", "two", "x", "y"], agent);
    expect(toRanges(written.authors)).toEqual([
      { author: "agent", start: 3, end: 4 },
    ]);

    const shifted = reconcile(written, ["zero", "one", "x", "y"], human);
    expect(toRanges(shifted.authors)).toEqual([
      { author: "human", start: 1, end: 1 },
      { author: "agent", start: 3, end: 4 },
    ]);
  });

  it("flips an agent line a person changed to human, keeping the rest", () => {
    const written = reconcile(unattributed([]), ["a", "b", "c"], agent);
    const edited = reconcile(written, ["a", "B", "c"], human);

    expect(toRanges(edited.authors)).toEqual([
      { author: "agent", start: 1, end: 1 },
      { author: "human", start: 2, end: 2 },
      { author: "agent", start: 3, end: 3 },
    ]);
  });

  it("splits text the way a diff counts lines", () => {
    expect(splitLines("a\r\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("agentEdits", () => {
  it("reads the lines an Edit, MultiEdit and Write wrote", () => {
    expect(
      agentEdits("Edit", { file_path: "/w/a.ts", new_string: "x  \ny" }),
    ).toEqual([{ filePath: "/w/a.ts", lines: new Set(["x", "y"]) }]);
    expect(
      agentEdits("MultiEdit", {
        file_path: "/w/a.ts",
        edits: [{ new_string: "p" }, { new_string: "q\nr" }],
      })[0]?.lines,
    ).toEqual(new Set(["p", "q", "r"]));
    expect(agentEdits("Write", { file_path: "b.ts", content: "z" })).toEqual([
      { filePath: "b.ts", lines: null },
    ]);
    expect(agentEdits("NotebookEdit", { notebook_path: "n.ipynb" })).toEqual([
      { filePath: "n.ipynb", lines: null },
    ]);
    expect(agentEdits("Read", { file_path: "a.ts" })).toEqual([]);
  });
});

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
let home: string | undefined;
const calls = { next: 0 };

function write(name: string, text: string): void {
  fs.writeFileSync(path.join(repo, name), text, "utf8");
}

/** The stream's tool_use, the edit landing on disk, then its tool_result. */
async function agentCall(
  name: string,
  input: Record<string, unknown>,
  apply: () => void,
): Promise<void> {
  const id = `call-${++calls.next}`;
  observeAttributionEvent("s1", {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  } as unknown as LlmStreamEvent);
  apply();
  observeAttributionEvent("s1", {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id }] },
  } as unknown as LlmStreamEvent);
  await settledLineAttribution();
}

async function rangesOf(file: string) {
  const { files } = await getLineAttribution("s1");

  return files.find((f) => f.path === file)?.ranges ?? [];
}

describe("line attribution", { timeout: 30_000 }, () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-attr-")),
    );
    repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    home = process.env.ARGUS_HOME;
    process.env.ARGUS_HOME = path.join(tmp, "home");
    execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, env });
    write("a.ts", "one\ntwo\nthree\n");
    execFileSync("git", ["add", "-A"], { cwd: repo, env });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: repo, env });
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
    resetLineAttribution();
    appState.sessions.delete("s1");
    appState.agents.delete("a1");
    if (home === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = home;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("records the lines an Edit wrote, from its payload", async () => {
    await agentCall(
      "Edit",
      {
        file_path: path.join(repo, "a.ts"),
        old_string: "two",
        new_string: "two\nadded\nmore",
      },
      () => write("a.ts", "one\ntwo\nadded\nmore\nthree\n"),
    );

    await expect(rangesOf("a.ts")).resolves.toEqual([
      { author: "agent", start: 3, end: 4 },
    ]);
  });

  it("marks a whole new file a Write made, with a relative path", async () => {
    await agentCall("Write", { file_path: "b.ts", content: "x\ny\n" }, () =>
      write("b.ts", "x\ny\n"),
    );

    await expect(rangesOf("b.ts")).resolves.toEqual([
      { author: "agent", start: 1, end: 2 },
    ]);
  });

  it("keeps ranges in place across later edits above them", async () => {
    await agentCall(
      "Edit",
      { file_path: path.join(repo, "a.ts"), new_string: "three\nfour" },
      () => write("a.ts", "one\ntwo\nthree\nfour\n"),
    );
    await agentCall(
      "Edit",
      { file_path: path.join(repo, "a.ts"), new_string: "zero\none" },
      () => write("a.ts", "zero\none\ntwo\nthree\nfour\n"),
    );

    await expect(rangesOf("a.ts")).resolves.toEqual([
      { author: "agent", start: 1, end: 1 },
      { author: "agent", start: 5, end: 5 },
    ]);
  });

  it("flips lines a person changed between turns to human", async () => {
    noteTurnStarted("s1");
    await agentCall(
      "Edit",
      { file_path: path.join(repo, "a.ts"), new_string: "two\nb1\nb2\nb3" },
      () => write("a.ts", "one\ntwo\nb1\nb2\nb3\nthree\n"),
    );
    noteTurnEnded("s1");
    await settledLineAttribution();
    write("a.ts", "one\ntwo\nb1\nB2 by hand\nb3\nmine\nthree\n");

    await expect(rangesOf("a.ts")).resolves.toEqual([
      { author: "agent", start: 3, end: 3 },
      { author: "human", start: 4, end: 4 },
      { author: "agent", start: 5, end: 5 },
      { author: "human", start: 6, end: 6 },
    ]);
  });

  it("flips an editor save to human even mid-turn", async () => {
    await agentCall("Write", { file_path: "c.ts", content: "p\nq\n" }, () =>
      write("c.ts", "p\nq\n"),
    );
    appState.agents.get("a1")!.status = "running";
    write("c.ts", "p\nQ\n");
    await noteHumanWrite("s1", path.join(repo, "c.ts"));

    await expect(rangesOf("c.ts")).resolves.toEqual([
      { author: "agent", start: 1, end: 1 },
      { author: "human", start: 2, end: 2 },
    ]);
  });

  it("leaves a change mid-turn unmarked until it's explained", async () => {
    await agentCall("Write", { file_path: "d.ts", content: "a\n" }, () =>
      write("d.ts", "a\n"),
    );
    appState.agents.get("a1")!.status = "running";
    write("d.ts", "new\na\n");

    await expect(rangesOf("d.ts")).resolves.toEqual([
      { author: "agent", start: 2, end: 2 },
    ]);
  });

  it("ignores lines a failed call or another file changed", async () => {
    observeAttributionEvent("s1", {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "bad",
            name: "Edit",
            input: { file_path: "a.ts", new_string: "x" },
          },
        ],
      },
    } as unknown as LlmStreamEvent);
    write("a.ts", "x\n");
    observeAttributionEvent("s1", {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "bad", is_error: true }],
      },
    } as unknown as LlmStreamEvent);
    await settledLineAttribution();

    await expect(getLineAttribution("s1")).resolves.toEqual({ files: [] });
  });

  it("keeps what it recorded outside the worktree, across a restart", async () => {
    await agentCall("Write", { file_path: "e.ts", content: "e\n" }, () =>
      write("e.ts", "e\n"),
    );
    resetLineAttribution();

    await expect(rangesOf("e.ts")).resolves.toEqual([
      { author: "agent", start: 1, end: 1 },
    ]);
    expect(fs.readdirSync(path.join(tmp, "home", "line-attribution"))).toEqual([
      "s1.json",
    ]);
    expect(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: repo,
        env,
        encoding: "utf8",
      }),
    ).not.toContain("attribution");
  });
});
