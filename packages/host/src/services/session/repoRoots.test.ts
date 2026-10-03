import type * as GitModule from "./git";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { addRepoRoot, removeRepoRoot, restoreRepoRoots } from "./manager";
import { loadPersistedRepoRoots, persistRepoRoots } from "./repoRootsStore";

vi.mock("../../main", () => ({ getMainWindow: () => null }));
vi.mock("./git", async () => {
  const actual = (await vi.importActual("./git")) as typeof GitModule;

  return {
    ...actual,
    git: vi.fn(async () => ""),
    repairOrphanedWorktrees: vi.fn(async () => {}),
  };
});
vi.mock("./setup", () => ({ runSetupPipeline: vi.fn(async () => {}) }));
vi.mock("./argusConfig", () => ({ loadArgusConfig: () => null }));

let home: string;
let repo: string;
const originalHome = process.env.ARGUS_HOME;

describe("repo root persistence", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-home-"));
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "argus-repo-"));
    process.env.ARGUS_HOME = home;
    appState.repoRoots.clear();
  });

  afterEach(() => {
    process.env.ARGUS_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("saves a root on add and drops it on remove", () => {
    addRepoRoot(repo);
    expect(loadPersistedRepoRoots()).toEqual([repo]);

    removeRepoRoot(repo);
    expect(loadPersistedRepoRoots()).toEqual([]);
  });

  it("registers a path once however it is spelled", () => {
    addRepoRoot(repo);
    addRepoRoot(path.join(repo, "..", path.basename(repo)) + "/");

    expect([...appState.repoRoots]).toEqual([repo]);
  });

  it("re-registers saved roots at startup", () => {
    persistRepoRoots([repo]);

    restoreRepoRoots();

    expect([...appState.repoRoots]).toEqual([repo]);
  });

  it("keeps an unreachable root saved rather than registering it", () => {
    const gone = path.join(repo, "unmounted");
    persistRepoRoots([gone]);

    restoreRepoRoots();
    expect([...appState.repoRoots]).toEqual([]);

    // A later add must not quietly evict the root we couldn't reach.
    addRepoRoot(repo);
    expect(loadPersistedRepoRoots().sort()).toEqual([gone, repo].sort());
  });

  it("returns nothing for a corrupt file", () => {
    fs.writeFileSync(path.join(home, "repo-roots.json"), "{not json", "utf8");
    expect(loadPersistedRepoRoots()).toEqual([]);
  });
});
