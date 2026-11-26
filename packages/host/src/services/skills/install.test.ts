import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeZip } from "../../lib/zip";
import {
  installSkill,
  listSkills,
  removeSkill,
  type SkillEnv,
  updateSkill,
} from "./install";
import { MANIFEST_FILE, readManifest } from "./manifest";

// Clones copy a local repository instead of reaching the network.
const origin = vi.hoisted(() => ({ dir: "" }));
vi.mock("../clone/run", () => ({
  runClone: (opts: { dest: string }) => {
    fs.cpSync(origin.dir, opts.dest, { recursive: true });

    return Promise.resolve();
  },
}));
vi.mock("../clone/jobs", () => ({ ghAvailable: () => Promise.resolve(false) }));

const skillMd = (name: string, description = "Does a thing.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

describe("skills", () => {
  let dir: string;
  let env: SkillEnv;
  let repo: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-skills-"));
    repo = path.join(dir, "projects", "tally");
    fs.mkdirSync(repo, { recursive: true });
    env = {
      homes: {
        home: path.join(dir, "home"),
        codexHome: path.join(dir, "codex"),
      },
      repoRoots: () => [repo],
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeSkill = (root: string, folder: string, text: string) => {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(path.join(root, folder, "SKILL.md"), text);
  };

  const userTarget = {
    scope: "user" as const,
    runner: "claude-code" as const,
    repo_root: null,
  };

  describe("discovery", () => {
    it("lists every runner's user and project skills", () => {
      writeSkill(
        path.join(dir, "home/.claude/skills"),
        "review",
        skillMd("review"),
      );
      writeSkill(path.join(dir, "codex/skills"), "deploy", skillMd("deploy"));
      writeSkill(
        path.join(repo, ".claude/skills"),
        "lint",
        skillMd("lint", "Lints  the\n  code."),
      );
      writeSkill(path.join(repo, ".codex/skills"), "triage", "no frontmatter");
      // Not skills: a runner's own dot-folder, and a folder without SKILL.md.
      writeSkill(path.join(dir, "codex/skills"), ".system", skillMd("system"));
      fs.mkdirSync(path.join(dir, "home/.claude/skills/empty"), {
        recursive: true,
      });

      const skills = listSkills(env);
      expect(
        skills.map((s) => [s.name, s.runner, s.scope, s.project_name]),
      ).toEqual([
        ["review", "claude-code", "user", null],
        ["deploy", "codex", "user", null],
        ["lint", "claude-code", "project", "tally"],
        ["triage", "codex", "project", "tally"],
      ]);
      expect(skills[2].description).toBe("Lints the code.");
      expect(skills[3].description).toBeNull();
      expect(skills[0].source).toBeNull();
      expect(skills[0].file_count).toBe(1);
    });
  });

  describe("install", () => {
    it("copies a folder, leaving out .git, and records where it came from", async () => {
      const src = path.join(dir, "src", "my-review");
      writeSkill(path.dirname(src), "my-review", skillMd("review"));
      fs.mkdirSync(path.join(src, ".git"));
      fs.writeFileSync(path.join(src, "notes.md"), "x");

      const result = await installSkill(
        {
          from: "folder",
          location: src,
          subpath: null,
          target: userTarget,
          overwrite: false,
        },
        env,
      );
      expect(result.status).toBe("installed");
      const dest = path.join(dir, "home/.claude/skills/review");
      expect(result.skill?.path).toBe(dest);
      expect(fs.existsSync(path.join(dest, ".git"))).toBe(false);
      expect(result.skill?.file_count).toBe(3);
      expect(readManifest(dest)).toMatchObject({
        kind: "folder",
        location: src,
      });
    });

    it("stops at exists, then replaces when told to", async () => {
      writeSkill(
        path.join(dir, "home/.claude/skills"),
        "review",
        skillMd("review", "Old."),
      );
      const src = path.join(dir, "src");
      writeSkill(src, "review", skillMd("review", "New."));
      const input = {
        from: "folder" as const,
        location: path.join(src, "review"),
        subpath: null,
        target: userTarget,
        overwrite: false,
      };

      await expect(installSkill(input, env)).resolves.toEqual({
        status: "exists",
        name: "review",
        skill: null,
      });
      expect(listSkills(env)[0].description).toBe("Old.");
      const replaced = await installSkill({ ...input, overwrite: true }, env);
      expect(replaced.skill?.description).toBe("New.");
    });

    it("unpacks a .skill file with its wrapper folder into a project", async () => {
      const file = path.join(dir, "review.skill");
      fs.writeFileSync(
        file,
        writeZip([
          { name: "review/SKILL.md", data: Buffer.from(skillMd("review")) },
          { name: "review/ref.md", data: Buffer.from("ref") },
        ]),
      );
      const result = await installSkill(
        {
          from: "archive",
          location: file,
          subpath: null,
          target: { scope: "project", runner: "codex", repo_root: repo },
          overwrite: false,
        },
        env,
      );
      expect(result.skill?.path).toBe(path.join(repo, ".codex/skills/review"));
      expect(result.skill?.source?.kind).toBe("archive");
    });

    it("refuses an archive that writes outside its folder", async () => {
      const file = path.join(dir, "evil.zip");
      fs.writeFileSync(
        file,
        writeZip([
          { name: "SKILL.md", data: Buffer.from(skillMd("evil")) },
          { name: "../../evil.txt", data: Buffer.from("x") },
        ]),
      );
      await expect(
        installSkill(
          {
            from: "archive",
            location: file,
            subpath: null,
            target: userTarget,
            overwrite: false,
          },
          env,
        ),
      ).rejects.toMatch(/outside its folder/);
      expect(listSkills(env)).toEqual([]);
    });

    it("needs a SKILL.md, and names the choices when there are several", async () => {
      const src = path.join(dir, "many");
      writeSkill(path.join(src, "skills"), "a", skillMd("a"));
      writeSkill(path.join(src, "skills"), "b", skillMd("b"));
      const input = {
        from: "folder" as const,
        location: src,
        subpath: null,
        target: userTarget,
        overwrite: false,
      };
      await expect(installSkill(input, env)).rejects.toMatch(
        /2 skills \(skills\/a, skills\/b\)/,
      );
      const picked = await installSkill({ ...input, subpath: "skills/b" }, env);
      expect(picked.name).toBe("b");

      fs.mkdirSync(path.join(dir, "plain"));
      await expect(
        installSkill({ ...input, location: path.join(dir, "plain") }, env),
      ).rejects.toMatch(/no SKILL.md/);
    });

    it("only installs into an open project", async () => {
      const src = path.join(dir, "src");
      writeSkill(src, "x", skillMd("x"));
      await expect(
        installSkill(
          {
            from: "folder",
            location: path.join(src, "x"),
            subpath: null,
            target: {
              scope: "project",
              runner: "claude-code",
              repo_root: "/elsewhere",
            },
            overwrite: false,
          },
          env,
        ),
      ).rejects.toMatch(/Pick one of your projects/);
    });
  });

  describe("git", () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });
    const commit = (message: string) => {
      git(origin.dir, "add", "-A");
      git(
        origin.dir,
        "-c",
        "user.email=a@b.c",
        "-c",
        "user.name=A",
        "commit",
        "-m",
        message,
      );
    };

    beforeEach(() => {
      origin.dir = path.join(dir, "origin");
      fs.mkdirSync(origin.dir);
      git(origin.dir, "init", "-b", "main");
      writeSkill(
        path.join(origin.dir, "skills"),
        "review",
        skillMd("review", "One."),
      );
      commit("one");
    });

    it("installs a folder of a repository and updates it when it moves on", async () => {
      const result = await installSkill(
        {
          from: "url",
          location: "https://github.com/octo/skills/tree/main/skills/review",
          subpath: null,
          target: userTarget,
          overwrite: false,
        },
        env,
      );
      const installed = result.skill!;
      expect(installed.source).toMatchObject({
        kind: "git",
        ref: "main",
        subpath: "skills/review",
      });
      expect(installed.source?.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(fs.existsSync(path.join(installed.path, ".git"))).toBe(false);

      expect((await updateSkill(installed.path, env)).changed).toBe(false);

      writeSkill(
        path.join(origin.dir, "skills"),
        "review",
        skillMd("review", "Two."),
      );
      commit("two");
      const updated = await updateSkill(installed.path, env);
      expect(updated.changed).toBe(true);
      expect(updated.skill.description).toBe("Two.");
      expect(updated.skill.source?.installed_at).toBe(
        installed.source?.installed_at,
      );
    });

    it("names a gist's skill from its frontmatter", async () => {
      fs.rmSync(path.join(origin.dir, "skills"), { recursive: true });
      fs.writeFileSync(path.join(origin.dir, "SKILL.md"), skillMd("gisted"));
      commit("gist");
      const result = await installSkill(
        {
          from: "url",
          location: "https://gist.github.com/octo/aa5a315d61ae9438b18d",
          subpath: null,
          target: userTarget,
          overwrite: false,
        },
        env,
      );
      expect(result.skill?.path).toBe(
        path.join(dir, "home/.claude/skills/gisted"),
      );
      expect(result.skill?.source?.kind).toBe("gist");
    });
  });

  describe("update and remove", () => {
    it("can't update a skill Argus didn't install", async () => {
      writeSkill(
        path.join(dir, "home/.claude/skills"),
        "review",
        skillMd("review"),
      );
      await expect(
        updateSkill(path.join(dir, "home/.claude/skills/review"), env),
      ).rejects.toMatch(/wasn't installed through Argus/);
    });

    it("re-copies a folder source", async () => {
      const src = path.join(dir, "src");
      writeSkill(src, "review", skillMd("review", "One."));
      const { skill } = await installSkill(
        {
          from: "folder",
          location: path.join(src, "review"),
          subpath: null,
          target: userTarget,
          overwrite: false,
        },
        env,
      );
      fs.writeFileSync(
        path.join(src, "review/SKILL.md"),
        skillMd("review", "Two."),
      );
      const updated = await updateSkill(skill!.path, env);
      expect(updated.skill.description).toBe("Two.");
      expect(fs.existsSync(path.join(skill!.path, MANIFEST_FILE))).toBe(true);
    });

    it("removes a listed skill and nothing else", async () => {
      writeSkill(
        path.join(dir, "home/.claude/skills"),
        "review",
        skillMd("review"),
      );
      const skillPath = path.join(dir, "home/.claude/skills/review");
      expect(() => removeSkill(path.join(dir, "home"), env)).toThrow();
      expect(removeSkill(skillPath, env)).toEqual({ removed: true });
      expect(fs.existsSync(skillPath)).toBe(false);
    });
  });
});
