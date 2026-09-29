import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveUserProjectSettings } from "../userProjectSettings/store";
import { worktreesRoot } from "./git";
import { projectDataDir, saveMetadata } from "./metadata";
import {
  CHAT_HISTORY_DIR,
  COMMAND_METRICS_FILE,
  evacuateWorktreeRoots,
  sidecarPath,
} from "./sidecars";
import { invalidateWorktreeLocationCache } from "./worktreeRootCache";

let tmp: string;
let repoRoot: string;

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeHistory(root: string, id: string, endedAt: number): void {
  const dir = path.join(root, CHAT_HISTORY_DIR);
  writeJson(path.join(dir, `${id}.json`), { id });
  const index = path.join(dir, "index.json");
  const entries = fs.existsSync(index)
    ? (readJson(index) as { entries: unknown[] }).entries
    : [];
  writeJson(index, { version: 1, entries: [...entries, { id, endedAt }] });
}

describe("evacuateWorktreeRoots", () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-sidecars-")),
    );
    // Unique per test: evacuation is memoized per repo for the process.
    repoRoot = path.join(tmp, "repo");
    invalidateWorktreeLocationCache();
  });

  afterEach(() => {
    invalidateWorktreeLocationCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps sidecars on the boot disk, not under the worktree root", () => {
    saveUserProjectSettings(repoRoot, {
      worktrees_base_dir: path.join(tmp, "external"),
    });

    expect(sidecarPath(repoRoot, CHAT_HISTORY_DIR)).toBe(
      path.join(projectDataDir(repoRoot), CHAT_HISTORY_DIR),
    );
  });

  it("leaves only worktrees under every root it has used", () => {
    const oldRoot = worktreesRoot(repoRoot);
    writeHistory(oldRoot, "a", 1);
    writeJson(path.join(oldRoot, COMMAND_METRICS_FILE), {
      version: 1,
      counts: { "/review": 2 },
    });
    writeJson(path.join(oldRoot, ".argus-sessions.json"), {});
    writeJson(path.join(oldRoot, ".argus-workspaces.json"), {});
    saveMetadata(repoRoot, new Map());

    saveUserProjectSettings(repoRoot, {
      worktrees_base_dir: path.join(tmp, "external"),
    });
    const newRoot = worktreesRoot(repoRoot);
    writeHistory(newRoot, "b", 2);
    writeJson(path.join(newRoot, COMMAND_METRICS_FILE), {
      version: 1,
      counts: { "/review": 1, "/plan": 1 },
    });
    fs.mkdirSync(path.join(newRoot, "feature"));

    evacuateWorktreeRoots(repoRoot);

    expect(fs.readdirSync(oldRoot)).toEqual([]);
    expect(fs.readdirSync(newRoot)).toEqual(["feature"]);

    const data = projectDataDir(repoRoot);
    const index = readJson(path.join(data, CHAT_HISTORY_DIR, "index.json")) as {
      entries: { id: string }[];
    };
    expect(index.entries.map((e) => e.id)).toEqual(["b", "a"]);
    expect(fs.existsSync(path.join(data, CHAT_HISTORY_DIR, "a.json"))).toBe(
      true,
    );
    expect(readJson(path.join(data, COMMAND_METRICS_FILE))).toEqual({
      version: 1,
      counts: { "/review": 3, "/plan": 1 },
    });
  });
});
