/**
 * Cross-project sessions against real git: a primary session in one repo,
 * converted to span a second repo, listed again after a restart, merged per
 * repo and deleted with every worktree.
 */

import type { Session } from "./models";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
const capture = vi.hoisted(() => vi.fn());
vi.mock("../telemetry/telemetry", () => ({ capture }));
vi.mock("./setup", () => ({ runSetupPipeline: vi.fn(async () => {}) }));
vi.mock("../terminal/multiplexer", () => ({
  createTerminal: () => {
    throw new Error("no pty in tests");
  },
  setupShell: () => "/bin/sh",
  SETUP_TERMINAL_TITLE: "Setup",
}));
vi.mock("../github/sessionPullRequests", () => ({
  withSessionPullRequest: (s: Session) => s,
  sessionPullRequest: () => null,
  sessionPullRequestMayHaveChanged: vi.fn(),
}));

const { loadMetadata, projectDataDir, saveMetadata } =
  await import("./metadata");
const { deleteSession, listSessions } = await import("./manager");
const { makeCrossProjectSession } = await import("./crossProject");
const { mergeSessionIntoBase } = await import("./sessionOps");
const { crossProjectContext, buildCrossProjectSection } =
  await import("../agent/contextPrompt");

let tmp: string;
let web: string;
let api: string;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main", "."]);
  fs.writeFileSync(path.join(dir, "a.txt"), "hi");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "init"]);
}

function addPrimary(): Session {
  const wt = path.join(tmp, "home/worktrees/web-argus-worktrees/feat_shared");
  git(web, ["worktree", "add", "-q", "-b", "feat/shared", wt, "main"]);
  const session: Session = {
    id: "primary",
    kind: "worktree",
    branch: "feat/shared",
    display_name: "Shared",
    description: "",
    path: wt,
    repo_root: web,
    status: "ready",
    base_branch: "main",
  };
  appState.sessions.set(session.id, session);
  saveMetadata(
    web,
    new Map([[wt, { id: "primary", display_name: "Shared", description: "" }]]),
  );

  return session;
}

async function waitGone(dir: string): Promise<void> {
  await vi.waitFor(() => expect(fs.existsSync(dir)).toBe(false), {
    timeout: 15000,
  });
}

describe("cross-project sessions (integration)", { timeout: 30000 }, () => {
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "argus-xp-")));
    vi.stubEnv("ARGUS_HOME", path.join(tmp, "home"));
    for (const [k, v] of Object.entries({
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    })) {
      vi.stubEnv(k, v);
    }
    web = path.join(tmp, "web");
    api = path.join(tmp, "api");
    initRepo(web);
    initRepo(api);
    appState.sessions.clear();
    appState.repoRoots.clear();
    appState.repoRoots.add(web);
    appState.repoRoots.add(api);
    capture.mockClear();
  });

  afterEach(() => {
    appState.sessions.clear();
    appState.repoRoots.clear();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reads an index written before cross-project sessions and writes it back byte for byte", () => {
    const old = JSON.stringify(
      {
        version: 2,
        sessions: {
          [path.join(tmp, "x")]: {
            id: "old",
            display_name: "Old",
            description: "",
            base_branch: "main",
            branch: "old",
            kind: "worktree",
          },
        },
      },
      null,
      2,
    );
    const file = path.join(projectDataDir(web), "sessions.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, old);

    saveMetadata(web, loadMetadata(web));

    expect(fs.readFileSync(file, "utf8")).toBe(old);
  });

  it("lists a single-repo session with neither cross-project field", async () => {
    addPrimary();

    const [listed] = await listSessions(web);

    expect("linked_repos" in listed).toBe(false);
    expect("cross_project_of" in listed).toBe(false);
    const raw = fs.readFileSync(
      path.join(projectDataDir(web), "sessions.json"),
      "utf8",
    );
    expect(raw).not.toMatch(/linked_repos|cross_project_of/);
  });

  it("adds a worktree per linked repo on the same branch name", async () => {
    addPrimary();

    const { session, failed } = await makeCrossProjectSession("primary", [api]);

    expect(failed).toEqual([]);
    expect(session.linked_repos).toHaveLength(1);
    const [linked] = session.linked_repos ?? [];
    expect(linked.repo_root).toBe(api);
    expect(linked.branch).toBe("feat/shared");
    expect(git(linked.worktree_path, ["branch", "--show-current"])).toBe(
      "feat/shared",
    );
    expect(appState.sessions.get(linked.session_id)?.cross_project_of).toBe(
      "primary",
    );
    expect(capture).toHaveBeenCalledWith("cross_project_session_created", {
      repos_bucket: "2",
      extended: false,
      failed: false,
    });

    const repos = crossProjectContext(session);
    expect(repos.map((r) => [r.repoRoot, r.current])).toEqual([
      [web, true],
      [api, false],
    ]);
    expect(buildCrossProjectSection(repos)).toContain(linked.worktree_path);
  });

  it("refuses a project the host doesn't know of", async () => {
    addPrimary();
    const stranger = path.join(tmp, "stranger");
    initRepo(stranger);

    await expect(
      makeCrossProjectSession("primary", [stranger]),
    ).rejects.toMatch(/unknown project/);
    expect(appState.repoRoots.has(stranger)).toBe(false);
  });

  it("lists both ends again after a restart", async () => {
    addPrimary();
    const { session } = await makeCrossProjectSession("primary", [api]);
    const memberId = session.linked_repos?.[0].session_id;

    appState.sessions.clear();
    const [primary] = await listSessions(web);
    const [member] = await listSessions(api);

    expect(primary.linked_repos?.[0].session_id).toBe(memberId);
    expect(member.id).toBe(memberId);
    expect(member.cross_project_of).toBe("primary");
  });

  it("merges one repo into its own base", async () => {
    addPrimary();
    const { session } = await makeCrossProjectSession("primary", [api]);
    const linked = session.linked_repos?.[0];
    if (!linked) {
      throw new Error("no linked repo");
    }
    fs.writeFileSync(path.join(linked.worktree_path, "b.txt"), "api");
    git(linked.worktree_path, ["add", "-A"]);
    git(linked.worktree_path, ["commit", "-qm", "api change"]);

    await mergeSessionIntoBase(linked.session_id, "squash");

    expect(git(api, ["log", "-1", "--format=%s", "main"])).toBe("api change");
    expect(git(web, ["log", "-1", "--format=%s", "main"])).toBe("init");
    expect(capture).toHaveBeenCalledWith("session_merged", {
      phase: "direct",
      strategy: "squash",
      cross_project: true,
    });
  });

  it("deletes every repo's worktree and branch with the session", async () => {
    const primary = addPrimary();
    const { session } = await makeCrossProjectSession("primary", [api]);
    const linked = session.linked_repos?.[0];
    if (!linked) {
      throw new Error("no linked repo");
    }

    await deleteSession("primary", true, { skipTeardown: true });

    await waitGone(primary.path);
    await waitGone(linked.worktree_path);
    await vi.waitFor(
      () => expect(git(api, ["branch", "--list", "feat/shared"])).toBe(""),
      { timeout: 15000 },
    );
    await vi.waitFor(() => expect(appState.sessions.size).toBe(0), {
      timeout: 15000,
    });
  });

  it("drops a linked repo deleted on its own from its primary", async () => {
    addPrimary();
    const { session } = await makeCrossProjectSession("primary", [api]);
    const linked = session.linked_repos?.[0];
    if (!linked) {
      throw new Error("no linked repo");
    }

    await deleteSession(linked.session_id, false, { skipTeardown: true });

    expect(appState.sessions.get("primary")?.linked_repos).toBeUndefined();
    const meta = [...loadMetadata(web).values()][0];
    expect(meta.linked_repos).toBeUndefined();
    await vi.waitFor(
      () => expect(appState.sessions.has(linked.session_id)).toBe(false),
      { timeout: 15000 },
    );
  });
});
