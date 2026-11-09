import type * as GitModule from "./git";
import type { ForkReplayOp } from "./manager";
import type { Session } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { forkClaudeSessionFile } from "../llm/runners/claudeCode/transcriptFork";
import { addWorktree, git } from "./git";
import { forkChatInSession, forkSession } from "./manager";

vi.mock("../../main", () => ({
  getMainWindow: () => null,
}));

vi.mock("./git", async () => {
  const actual = (await vi.importActual("./git")) as typeof GitModule;

  return {
    ...actual,
    git: vi.fn(async () => ""),
    addWorktree: vi.fn(async () => {}),
    repairOrphanedWorktrees: vi.fn(async () => {}),
  };
});

vi.mock("./setup", () => ({
  runSetupPipeline: vi.fn(async () => {}),
}));

vi.mock("./argusConfig", () => ({
  loadArgusConfig: () => null,
}));

vi.mock("../llm/runners/claudeCode/transcriptFork", async (importActual) => ({
  ...(await importActual<object>()),
  forkClaudeSessionFile: vi.fn(async () => "claude-forked"),
}));

const FORK_MS = Date.parse("2026-04-01T12:00:00.000Z");
const COMMIT_SECS = Date.parse("2026-04-01T11:00:00.000Z") / 1000;

let home: string;
let repoRoot: string;
let srcPath: string;
let destPath: string;

function addSource(partial: Partial<Session> = {}): Session {
  const session: Session = {
    id: "src",
    kind: "worktree",
    branch: "feature",
    display_name: "Feature",
    description: "",
    path: srcPath,
    repo_root: repoRoot,
    status: "ready",
    env_index: null,
    base_branch: "main",
    ...partial,
  };
  appState.sessions.set(session.id, session);

  return session;
}

interface GitAnswers {
  before?: Error | string;
  commitTime?: string;
  root?: Error | string;
}

function answerFor(answers: GitAnswers, args: string[]): Error | string {
  if (args[0] === "show") {
    return answers.commitTime ?? "";
  }
  if (args[0] !== "rev-list") {
    return "";
  }
  if (args.some((a) => a.startsWith("--before="))) {
    return answers.before ?? "";
  }

  return args.includes("--max-parents=0") ? (answers.root ?? "") : "";
}

/** Answers the `git` calls forkSession makes; everything else returns "". */
function mockGit(answers: GitAnswers): void {
  vi.mocked(git).mockImplementation(async (_cwd, args) => {
    const answer = answerFor(answers, args);
    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  });
}

function gitCalls(cmd: string): string[][] {
  return vi
    .mocked(git)
    .mock.calls.filter(([, args]) => args[0] === cmd)
    .map(([, args]) => args);
}

function fork(replayOps?: ForkReplayOp[], claudeSessionId?: string | null) {
  return forkSession(
    "src",
    "forked",
    "a fork",
    FORK_MS,
    3,
    claudeSessionId,
    replayOps,
  );
}

function setUp(): void {
  appState.sessions.clear();
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "argus-")));
  vi.stubEnv("ARGUS_HOME", home);
  repoRoot = path.join(home, "repo");
  srcPath = path.join(home, "src-worktree");
  fs.mkdirSync(repoRoot);
  fs.mkdirSync(srcPath);
  appState.repoRoots.add(repoRoot);
  destPath = "";
  vi.mocked(addWorktree).mockImplementation(async (_repo, target) => {
    destPath = target;
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, ".git"), "gitdir: elsewhere");
  });
  vi.mocked(addWorktree).mockClear();
  vi.mocked(git).mockClear();
  vi.mocked(forkClaudeSessionFile).mockClear();
}

function tearDown(): void {
  vi.unstubAllEnvs();
  vi.mocked(git).mockReset();
  vi.mocked(git).mockImplementation(async () => "");
  vi.mocked(forkClaudeSessionFile).mockImplementation(
    async () => "claude-forked",
  );
  fs.rmSync(home, { recursive: true, force: true });
}

describe("forkSession", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it("rejects an unknown session", async () => {
    await expect(fork()).rejects.toBe("Session not found: src");
  });

  it("rejects sessions that aren't worktrees or the project root", async () => {
    addSource({ kind: "scratch_pad" });

    await expect(fork()).rejects.toBe(
      'Cannot fork a session of kind "scratch_pad"',
    );
  });

  it("branches off the source and resets to the last commit before the fork", async () => {
    addSource();
    mockGit({ before: "abc123\n", commitTime: String(COMMIT_SECS) });

    const { session } = await fork();

    expect(session).toMatchObject({
      repo_root: repoRoot,
      branch: "forked",
      description: "a fork",
      base_branch: "feature",
      path: destPath,
    });
    expect(gitCalls("rev-list")).toEqual([
      [
        "rev-list",
        "-n",
        "1",
        `--before=${new Date(FORK_MS).toISOString()}`,
        "feature",
      ],
    ]);
    expect(gitCalls("reset")).toEqual([["reset", "--hard", "abc123"]]);
    expect(appState.sessions.get("src")?.path).toBe(srcPath);
  });

  it("falls back to the branch's root commit when nothing predates the fork", async () => {
    addSource();
    mockGit({ before: "", root: "root1\nroot2\n" });

    await fork();

    expect(gitCalls("reset")).toEqual([["reset", "--hard", "root1"]]);
  });

  it("skips the reset when no commit can be found", async () => {
    addSource();
    mockGit({ before: new Error("bad rev"), root: new Error("bad rev") });

    const { session } = await fork();

    expect(session.path).toBe(destPath);
    expect(gitCalls("reset")).toEqual([]);
  });

  it("still forks when the reset fails", async () => {
    addSource();
    vi.mocked(git).mockImplementation(async (_cwd, args) => {
      if (args[0] === "reset") {
        throw "reset failed";
      }

      return args[0] === "rev-list" ? "abc123" : "";
    });

    const { session } = await fork();

    expect(session.path).toBe(destPath);
  });

  it("works from the project-root session too", async () => {
    addSource({ kind: "project_root", path: repoRoot, branch: "main" });
    mockGit({ before: "abc123" });

    const { session } = await fork();

    expect(session.base_branch).toBe("main");
    expect(gitCalls("rev-list")[0].at(-1)).toBe("main");
  });

  describe("replaying uncommitted edits", () => {
    const at = (offsetMinutes: number) => FORK_MS + offsetMinutes * 60_000;
    const read = (file: string) =>
      fs.readFileSync(path.join(destPath, file), "utf8");

    beforeEach(() => {
      addSource();
      mockGit({ before: "abc123", commitTime: String(COMMIT_SECS) });
    });

    it("applies writes and edits made between the commit and the fork", async () => {
      await fork([
        {
          type: "write",
          filePath: path.join(srcPath, "src/new.ts"),
          content: "const a = 1;\nconst b = 1;\n",
          timestampMs: at(-30),
        },
        {
          type: "edit",
          filePath: path.join(srcPath, "src/new.ts"),
          oldString: "a = 1",
          newString: "a = 2",
          timestampMs: at(-20),
        },
        {
          type: "multiEdit",
          filePath: path.join(srcPath, "src/new.ts"),
          edits: [
            { oldString: "1", newString: "3", replaceAll: true },
            { oldString: "const", newString: "let" },
          ],
          timestampMs: at(0),
        },
      ]);

      expect(read("src/new.ts")).toBe("let a = 2;\nconst b = 3;\n");
    });

    it("leaves out edits the commit already has and edits after the fork", async () => {
      await fork([
        {
          type: "write",
          filePath: path.join(srcPath, "committed.txt"),
          content: "old",
          timestampMs: COMMIT_SECS * 1000,
        },
        {
          type: "write",
          filePath: path.join(srcPath, "later.txt"),
          content: "later",
          timestampMs: at(1),
        },
      ]);

      expect(fs.existsSync(path.join(destPath, "committed.txt"))).toBe(false);
      expect(fs.existsSync(path.join(destPath, "later.txt"))).toBe(false);
    });

    it("never writes outside the new worktree", async () => {
      const outside = path.join(home, "outside.txt");

      await fork([
        {
          type: "write",
          filePath: outside,
          content: "escaped",
          timestampMs: at(-5),
        },
      ]);

      expect(fs.existsSync(outside)).toBe(false);
    });

    it("leaves a file alone when an edit's text isn't there", async () => {
      await fork([
        {
          type: "write",
          filePath: path.join(srcPath, "kept.txt"),
          content: "unchanged",
          timestampMs: at(-10),
        },
        {
          type: "edit",
          filePath: path.join(srcPath, "kept.txt"),
          oldString: "missing",
          newString: "replaced",
          timestampMs: at(-5),
        },
        {
          type: "edit",
          filePath: path.join(srcPath, "absent.txt"),
          oldString: "missing",
          newString: "replaced",
          timestampMs: at(-5),
        },
      ]);

      expect(read("kept.txt")).toBe("unchanged");
      expect(fs.existsSync(path.join(destPath, "absent.txt"))).toBe(false);
    });

    it("replays everything up to the fork when there's no commit to reset to", async () => {
      mockGit({ before: "", root: "" });

      await fork([
        {
          type: "write",
          filePath: path.join(srcPath, "early.txt"),
          content: "early",
          timestampMs: at(-600),
        },
      ]);

      expect(read("early.txt")).toBe("early");
      expect(gitCalls("show")).toEqual([]);
    });
  });

  describe("the Claude transcript", () => {
    beforeEach(() => {
      addSource();
      mockGit({ before: "abc123" });
    });

    it("copies it into the new worktree, cut at the fork", async () => {
      const result = await fork(undefined, "claude-src");

      expect(result.claude_session_id).toBe("claude-forked");
      expect(forkClaudeSessionFile).toHaveBeenCalledWith({
        sourceCwd: srcPath,
        sourceSessionId: "claude-src",
        destCwd: destPath,
        destBranch: "forked",
        forkTimestampMs: FORK_MS,
        forkTurnNumber: 3,
      });
    });

    it("is skipped when the source has no Claude session", async () => {
      const result = await fork(undefined, null);

      expect(result.claude_session_id).toBeNull();
      expect(forkClaudeSessionFile).not.toHaveBeenCalled();
    });

    it("forks the worktree anyway when the transcript can't be copied", async () => {
      vi.mocked(forkClaudeSessionFile).mockRejectedValueOnce(
        new Error("no jsonl"),
      );

      const result = await fork(undefined, "claude-src");

      expect(result.claude_session_id).toBeNull();
      expect(result.session.path).toBe(destPath);
    });
  });
});

describe("forkChatInSession", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it("rejects an unknown session", async () => {
    await expect(
      forkChatInSession("src", "claude-src", FORK_MS, 3),
    ).rejects.toBe("Session not found: src");
  });

  it("rejects sessions that aren't worktrees or the project root", async () => {
    addSource({ kind: "scratch_pad" });

    await expect(
      forkChatInSession("src", "claude-src", FORK_MS, 3),
    ).rejects.toBe('Cannot fork a session of kind "scratch_pad"');
  });

  it("forks the transcript in place, leaving the worktree alone", async () => {
    addSource();
    const sessionsBefore = [...appState.sessions.keys()];

    const result = await forkChatInSession("src", "claude-src", FORK_MS, 3);

    expect(result).toEqual({ claude_session_id: "claude-forked" });
    expect(forkClaudeSessionFile).toHaveBeenCalledWith({
      sourceCwd: srcPath,
      sourceSessionId: "claude-src",
      destCwd: srcPath,
      destBranch: "feature",
      forkTimestampMs: FORK_MS,
      forkTurnNumber: 3,
    });
    expect([...appState.sessions.keys()]).toEqual(sessionsBefore);
    expect(addWorktree).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalled();
  });

  it("passes on a null id when there was nothing to fork", async () => {
    addSource({ kind: "project_root", path: repoRoot, branch: "main" });
    vi.mocked(forkClaudeSessionFile).mockResolvedValueOnce(null);

    const result = await forkChatInSession("src", "claude-src", FORK_MS, 0);

    expect(result.claude_session_id).toBeNull();
  });

  it("lets a transcript failure reach the caller", async () => {
    addSource();
    vi.mocked(forkClaudeSessionFile).mockRejectedValueOnce(
      new Error("no jsonl"),
    );

    await expect(
      forkChatInSession("src", "claude-src", FORK_MS, 3),
    ).rejects.toThrow("no jsonl");
  });
});
