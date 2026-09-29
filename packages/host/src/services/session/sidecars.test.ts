import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveUserProjectSettings } from "../userProjectSettings/store";
import { worktreesRoot } from "./git";
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

  it("follows the root when the location changes without a move", () => {
    const oldRoot = worktreesRoot(repoRoot);
    fs.mkdirSync(path.join(oldRoot, CHAT_HISTORY_DIR), { recursive: true });
    fs.writeFileSync(
      path.join(oldRoot, CHAT_HISTORY_DIR, "index.json"),
      "{}",
      "utf8",
    );

    saveUserProjectSettings(repoRoot, {
      worktrees_base_dir: path.join(tmp, "elsewhere"),
    });
    const newRoot = worktreesRoot(repoRoot);
    expect(newRoot).not.toBe(oldRoot);

    const dir = sidecarPath(repoRoot, CHAT_HISTORY_DIR);

    expect(dir).toBe(path.join(newRoot, CHAT_HISTORY_DIR));
    expect(fs.readFileSync(path.join(dir, "index.json"), "utf8")).toBe("{}");
    expect(fs.existsSync(path.join(oldRoot, CHAT_HISTORY_DIR))).toBe(false);
  });

  it("points at the current root when nothing exists yet", () => {
    expect(sidecarPath(repoRoot, CHAT_HISTORY_DIR)).toBe(
      path.join(worktreesRoot(repoRoot), CHAT_HISTORY_DIR),
    );
  });
});
