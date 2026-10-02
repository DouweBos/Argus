import type * as AutoFetchModule from "./autoFetch";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { createHeadSession, renameSession } from "./manager";

vi.mock("./watcher", () => ({ startBranchWatcher: () => ({ stop() {} }) }));
vi.mock("./gitWatcher", () => ({
  attachGitWatcher: vi.fn(async () => {}),
  detachGitWatcher: vi.fn(),
}));
vi.mock("./autoFetch", async (importActual) => ({
  ...(await importActual<typeof AutoFetchModule>()),
  reconfigureAutoFetch: vi.fn(),
}));

let repoRoot: string;

function initRepo(dir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ],
    { cwd: dir },
  );
}

/** What a host restart leaves behind: nothing in memory, only what's on disk. */
function restart(): void {
  appState.sessions.clear();
  appState.watchers.clear();
}

describe("createHeadSession", () => {
  beforeEach(() => {
    restart();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-root-session-"));
    initRepo(repoRoot);
  });

  afterEach(() => {
    restart();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("keeps the same id across a restart", () => {
    const first = createHeadSession(repoRoot);
    restart();
    const second = createHeadSession(repoRoot);

    expect(second.id).toBe(first.id);
  });

  it("keeps a rename across a restart", () => {
    const first = createHeadSession(repoRoot);
    renameSession(first.id, "Trunk");
    restart();

    expect(createHeadSession(repoRoot).display_name).toBe("Trunk");
  });

  it("gives each project its own id", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "argus-root-other-"));
    initRepo(other);
    try {
      expect(createHeadSession(other).id).not.toBe(
        createHeadSession(repoRoot).id,
      );
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
