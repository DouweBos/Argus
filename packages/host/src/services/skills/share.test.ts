import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill, type SkillEnv } from "./install";
import { MANIFEST_FILE } from "./manifest";
import { exportSkill, shareableFiles, shareSkill } from "./share";

describe("sharing a skill", () => {
  let dir: string;
  let env: SkillEnv;
  let skillDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-skill-share-"));
    env = {
      homes: {
        home: path.join(dir, "home"),
        codexHome: path.join(dir, "codex"),
      },
      repoRoots: () => [],
    };
    skillDir = path.join(dir, "home/.claude/skills/review");
    fs.mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(skillDir, ".git"));
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: review\ndescription: Reviews.\n---\n",
    );
    fs.writeFileSync(path.join(skillDir, "scripts/run.sh"), "echo hi\n");
    fs.writeFileSync(path.join(skillDir, ".git/HEAD"), "ref\n");
    fs.writeFileSync(path.join(skillDir, MANIFEST_FILE), "{}");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("leaves .git and the install record behind", () => {
    expect(shareableFiles(skillDir)).toEqual(["SKILL.md", "scripts/run.sh"]);
  });

  it("exports a .skill file that installs again", async () => {
    const file = path.join(dir, "review.skill");
    expect(exportSkill(skillDir, file, env)).toEqual({ path: file });
    fs.rmSync(skillDir, { recursive: true });

    const result = await installSkill(
      {
        from: "archive",
        location: file,
        subpath: null,
        target: { scope: "user", runner: "codex", repo_root: null },
        overwrite: false,
      },
      env,
    );
    expect(result.skill?.path).toBe(path.join(dir, "codex/skills/review"));
    expect(
      fs.readFileSync(
        path.join(dir, "codex/skills/review/scripts/run.sh"),
        "utf8",
      ),
    ).toBe("echo hi\n");
  });

  it("refuses a gist for a skill with folders", async () => {
    await expect(
      shareSkill(
        { path: skillDir, target: "gist", public: false, repo_name: null },
        env,
      ),
    ).rejects.toMatch(/no folders/);
  });

  it("only shares a skill the list shows", async () => {
    await expect(
      shareSkill(
        { path: dir, target: "gist", public: false, repo_name: null },
        env,
      ),
    ).rejects.toMatch(/isn't there/);
  });

  it("refuses a repository name that can't be one", async () => {
    await expect(
      shareSkill(
        { path: skillDir, target: "repo", public: false, repo_name: "a b" },
        env,
      ),
    ).rejects.toMatch(/isn't a repository name/);
  });
});
