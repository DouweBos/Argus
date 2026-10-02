/**
 * The command surface end to end, the way a client drives it: register a
 * project, open a session, edit/stage/commit, run a terminal, tear it down —
 * every call through `dispatchCommand`, so params are validated and every
 * result is checked against its catalog schema (a mismatch throws in tests).
 */

import type {
  CommandName,
  ParamsIn,
  ResultOf,
  Session,
} from "@argus/remote-protocol";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-flow-home-"));
const repo = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "argus-flow-repo-")),
);

vi.stubEnv("ARGUS_HOME", home);

const { dispatchCommand, resetCommandRegistry } =
  await import("../services/command/registry");
const { registerHostCommands } = await import("./index");

function run<N extends CommandName>(
  name: N,
  ...params: Record<string, never> extends ParamsIn<N>
    ? [ParamsIn<N>?]
    : [ParamsIn<N>]
): Promise<ResultOf<N>> {
  return dispatchCommand(name, params[0] ?? {}) as Promise<ResultOf<N>>;
}

async function waitForReady(id: string): Promise<Session> {
  for (let i = 0; i < 200; i++) {
    const session = await run("get_session", { id });
    if (session?.status === "ready") {
      return session;
    }
    if (typeof session?.status === "object") {
      throw new Error(`session setup failed: ${session.status.error}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("session never became ready");
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8" });
}

describe("a client session, through the command surface", () => {
  beforeAll(() => {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "flow@example.com");
    git("config", "user.name", "Flow");
    fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    resetCommandRegistry();
    registerHostCommands();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    // A git status run the session kicked off can still be writing in here.
    for (const dir of [home, repo]) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  it("registers a project and sees it hydrate", async () => {
    await run("add_repo_root", { path: repo });
    const projects = await run("list_projects");
    expect(projects.some((p) => p.path === repo && p.registered)).toBe(true);
    const snapshot = await run("state_hydrate");
    expect(snapshot.projects.map((p) => p.path)).toContain(repo);
  });

  it("rejects malformed params before any service runs", async () => {
    await expect(
      dispatchCommand("create_session", { repoRoot: repo }),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  it("opens a session, commits in it, and cleans up", async () => {
    const created = await run("create_session", {
      repoRoot: repo,
      branch: "flow-branch",
      description: "flow",
    });
    const session = await waitForReady(created.id);
    expect(
      (await run("list_sessions", { repoRoot: repo })).map((s) => s.id),
    ).toContain(session.id);

    await run("write_file", {
      id: session.id,
      relativePath: "notes.txt",
      content: "from the flow\n",
    });
    await expect(
      run("read_file", { id: session.id, relativePath: "notes.txt" }),
    ).resolves.toBe("from the flow\n");
    expect((await run("git_status", { id: session.id })).dirtyCount).toBe(1);
    await expect(
      run("get_session_status", { id: session.id }),
    ).resolves.toContain("notes.txt");

    await run("stage_all", { id: session.id });
    await run("git_commit", { id: session.id, message: "add notes" });
    const log = await run("git_log", { id: session.id, count: 5 });
    expect(log[0]?.subject).toBe("add notes");
    await expect(
      run("get_session_commits_ahead", { id: session.id }),
    ).resolves.toBe(1);

    const terminalId = await run("create_terminal", {
      sessionId: session.id,
      title: "flow",
    });
    await run("start_terminal", { sessionId: terminalId, cols: 80, rows: 24 });
    await run("terminal_write", { sessionId: terminalId, data: "echo hi\r" });
    const terminals = await run("list_terminals", { sessionId: session.id });
    expect(terminals.map((t) => t.id)).toContain(terminalId);
    await run("destroy_terminal", { sessionId: terminalId });

    await run("delete_session", { id: session.id, shouldDeleteBranch: true });
    expect(
      (await run("list_sessions", { repoRoot: repo })).map((s) => s.id),
    ).not.toContain(session.id);
  }, 60_000);
});
