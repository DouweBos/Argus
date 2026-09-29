import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveUserProjectSettings } from "../userProjectSettings/store";
import { worktreesRoot } from "./git";
import { projectDataDir } from "./metadata";
import { CHAT_HISTORY_DIR, sidecarPath } from "./sidecars";
import { invalidateWorktreeLocationCache } from "./worktreeRootCache";

let argusHome: string | undefined;
let tmp: string;
let repoRoot: string;

describe("sidecarPath", () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-sidecars-")),
    );
    repoRoot = path.join(tmp, "repo");
    argusHome = process.env.ARGUS_HOME;
    process.env.ARGUS_HOME = path.join(tmp, "argus-home");
    invalidateWorktreeLocationCache();
  });

  afterEach(() => {
    if (argusHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = argusHome;
    }
    invalidateWorktreeLocationCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const keepTarget = () => {};

  function writeStray(root: string, body: string): void {
    fs.mkdirSync(path.join(root, CHAT_HISTORY_DIR), { recursive: true });
    fs.writeFileSync(
      path.join(root, CHAT_HISTORY_DIR, "index.json"),
      body,
      "utf8",
    );
  }

  it("lives on the boot disk, not under the worktree root", () => {
    saveUserProjectSettings(repoRoot, {
      worktrees_base_dir: path.join(tmp, "external"),
    });

    expect(sidecarPath(repoRoot, CHAT_HISTORY_DIR, keepTarget)).toBe(
      path.join(projectDataDir(repoRoot), CHAT_HISTORY_DIR),
    );
  });

  it("adopts copies left at old and current worktree roots", () => {
    const oldRoot = worktreesRoot(repoRoot);
    writeStray(oldRoot, "old");
    saveUserProjectSettings(repoRoot, {
      worktrees_base_dir: path.join(tmp, "external"),
    });
    const newRoot = worktreesRoot(repoRoot);
    writeStray(newRoot, "new");

    const merged: string[] = [];
    const dir = sidecarPath(repoRoot, CHAT_HISTORY_DIR, (from) => {
      merged.push(fs.readFileSync(path.join(from, "index.json"), "utf8"));
    });

    expect(fs.readFileSync(path.join(dir, "index.json"), "utf8")).toBe("new");
    expect(merged).toEqual(["old"]);
    expect(fs.existsSync(path.join(oldRoot, CHAT_HISTORY_DIR))).toBe(false);
    expect(fs.existsSync(path.join(newRoot, CHAT_HISTORY_DIR))).toBe(false);
  });
});
