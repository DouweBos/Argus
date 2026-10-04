/**
 * The host half of a remote git runner, against a real repo with a linked
 * worktree: the shape GroveKit sees for an Argus session.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));
vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));

const { appState } = await import("../../state");
const { emitHostEvent } = vi.mocked(await import("@argus/host/bus"));
const {
  INLINE_LIMIT,
  gitRunnerCancel,
  gitRunnerInfo,
  gitRunnerOutput,
  gitRunnerRun,
} = await import("./runner");

let base: string;
let repo: string;
let worktree: string;

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

const b64 = (s: string) => Buffer.from(s).toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

describe("remote git runner", () => {
  beforeAll(async () => {
    base = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-gitrunner-")),
    );
    repo = path.join(base, "repo");
    worktree = path.join(base, "worktrees", "feature");
    await fs.promises.mkdir(repo);
    sh(repo, "init", "-q", "-b", "main");
    sh(repo, "config", "user.email", "t@example.com");
    sh(repo, "config", "user.name", "T");
    await fs.promises.writeFile(path.join(repo, "a.txt"), "hello\n");
    sh(repo, "add", ".");
    sh(repo, "commit", "-qm", "init");
    sh(repo, "worktree", "add", "-q", "-b", "feature", worktree);
  });

  beforeEach(() => {
    appState.sessions.clear();
    appState.repoRoots.clear();
    appState.sessions.set("s1", { path: worktree } as never);
    appState.repoRoots.add(repo);
    emitHostEvent.mockClear();
  });

  afterAll(async () => {
    await fs.promises.rm(base, { recursive: true, force: true });
  });

  describe("git_runner_info", () => {
    it("reports the linked worktree's git dirs and creates the scratch dir", async () => {
      const info = await gitRunnerInfo("s1");
      expect(info).toEqual({
        worktree,
        gitDir: path.join(repo, ".git", "worktrees", "feature"),
        commonGitDir: path.join(repo, ".git"),
        scratchDir: path.join(
          repo,
          ".git",
          "worktrees",
          "feature",
          "argus-scratch",
        ),
      });
      expect(fs.statSync(info.scratchDir).isDirectory()).toBe(true);
    });

    it("refuses an unknown session", async () => {
      await expect(gitRunnerInfo("nope")).rejects.toMatch(/Session not found/);
    });
  });

  describe("git_runner_run", () => {
    it("returns stdout as base64 and runs in the worktree by default", async () => {
      const res = await gitRunnerRun({
        sessionId: "s1",
        args: ["rev-parse", "--abbrev-ref", "HEAD"],
      });
      expect(res.exitCode).toBe(0);
      expect(unb64(res.stdout)).toBe("feature\n");
      expect(res.stdoutBytes).toBe(8);
      expect(res.outputId).toBeUndefined();
    });

    it("feeds stdin", async () => {
      const res = await gitRunnerRun({
        sessionId: "s1",
        args: ["hash-object", "--stdin"],
        stdin: b64("hello\n"),
      });
      expect(unb64(res.stdout).trim()).toBe(
        sh(repo, "rev-parse", "HEAD:a.txt").trim(),
      );
    });

    it("returns a nonzero exit instead of throwing", async () => {
      const res = await gitRunnerRun({
        sessionId: "s1",
        args: ["rev-parse", "--verify", "no-such-ref"],
      });
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toMatch(/fatal/);
    });

    it("layers the caller's env over the defaults", async () => {
      const res = await gitRunnerRun({
        sessionId: "s1",
        args: ["var", "GIT_PAGER"],
        env: { GIT_PAGER: "less" },
      });
      expect(unb64(res.stdout).trim()).toBe("less");
      const defaults = await gitRunnerRun({
        sessionId: "s1",
        args: ["var", "GIT_PAGER"],
      });
      expect(unb64(defaults.stdout).trim()).toBe("cat");
    });

    it("allows the git dir as cwd via the project root", async () => {
      const { gitDir } = await gitRunnerInfo("s1");
      const res = await gitRunnerRun({
        sessionId: "s1",
        args: ["rev-parse", "--git-dir"],
        cwd: gitDir,
      });
      expect(res.exitCode).toBe(0);
    });

    it("refuses a cwd outside the session and projects", async () => {
      await expect(
        gitRunnerRun({ sessionId: "s1", args: ["status"], cwd: os.tmpdir() }),
      ).rejects.toMatch(/outside/);
      await expect(
        gitRunnerRun({ sessionId: "s1", args: ["status"], cwd: "relative" }),
      ).rejects.toMatch(/absolute/);
    });

    it("pages output past the inline limit", async () => {
      const big = "x".repeat(INLINE_LIMIT + 1024);
      const res = await gitRunnerRun({
        sessionId: "s1",
        args: ["hash-object", "--stdin", "-w"],
        stdin: b64(big),
      });
      const oid = unb64(res.stdout).trim();
      const cat = await gitRunnerRun({
        sessionId: "s1",
        args: ["cat-file", "blob", oid],
      });
      expect(cat.stdout).toBe("");
      expect(cat.stdoutBytes).toBe(big.length);
      expect(cat.outputId).toBeDefined();

      const chunks: Buffer[] = [];
      let offset = 0;
      for (;;) {
        const page = gitRunnerOutput(cat.outputId ?? "", offset);
        const data = Buffer.from(page.data, "base64");
        chunks.push(data);
        offset += data.length;
        if (page.done) {
          break;
        }
      }
      expect(chunks).toHaveLength(2);
      expect(Buffer.concat(chunks).toString()).toBe(big);
      // Fully read output is released.
      expect(() => gitRunnerOutput(cat.outputId ?? "", 0)).toThrow(/expired/);
    });

    it("streams stderr as progress events when given a runId", async () => {
      await gitRunnerRun({
        sessionId: "s1",
        args: ["rev-parse", "--verify", "no-such-ref"],
        runId: "r1",
      });
      const calls = emitHostEvent.mock.calls.filter(
        ([channel]) => channel === "git-runner:progress:r1",
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(
        calls.map(([, p]) => (p as { chunk: string }).chunk).join(""),
      ).toMatch(/fatal/);
    });

    it("emits nothing without a runId", async () => {
      await gitRunnerRun({
        sessionId: "s1",
        args: ["rev-parse", "--verify", "x"],
      });
      expect(emitHostEvent).not.toHaveBeenCalled();
    });

    it("cancels a running command", async () => {
      // An alias shell keeps its own child; cancel has to take the group.
      const slow = gitRunnerRun({
        sessionId: "s1",
        args: ["-c", "alias.wait=!sleep 30", "wait"],
        runId: "r2",
      });
      await new Promise((r) => setTimeout(r, 200));
      gitRunnerCancel("r2");
      const res = await slow;
      expect(res.exitCode).not.toBe(0);
    });

    it("treats cancelling an unknown run as a no-op", () => {
      expect(() => gitRunnerCancel("never")).not.toThrow();
    });
  });
});
