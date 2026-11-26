/**
 * Sharing a skill: a `.skill` file (a zip of its folder), a gist, or a new
 * GitHub repository through `gh`. Each link it returns is one Install Skill
 * takes. `.git`, links and Argus's own install record stay behind.
 */

import type { SkillShareInput, SkillShareResult } from "@argus/remote-protocol";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { info } from "@argus/host/logger";
import { writeZip, type ZipFile } from "../../lib/zip";
import { folderNameProblem } from "../clone/url";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { knownSkill, type SkillEnv, skillEnv } from "./install";
import { MANIFEST_FILE } from "./manifest";

const execFileAsync = promisify(execFile);

/** Gists and repositories are for text, so a skill bigger than this stays local. */
const MAX_SHARE_BYTES = 20 * 1024 * 1024;

/** The files Share sends, relative to the skill's folder, with forward slashes. */
export function shareableFiles(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        e.name === ".git" ||
        e.name === ".DS_Store" ||
        (!rel && e.name === MANIFEST_FILE)
      ) {
        continue;
      }
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), relPath);
      } else if (e.isFile()) {
        out.push(relPath);
      }
    }
  };
  walk(skillDir, "");

  return out.sort();
}

function checkSize(skillDir: string, files: string[]): void {
  const total = files.reduce(
    (sum, f) => sum + fs.statSync(path.join(skillDir, f)).size,
    0,
  );
  if (total > MAX_SHARE_BYTES) {
    throw "That skill is over 20 MB, too big to share.";
  }
}

/** The skill's folder as a zip with one top-level folder, as `.skill` files carry it. */
export function skillArchive(skillDir: string): Buffer {
  const files = shareableFiles(skillDir);
  checkSize(skillDir, files);
  const name = path.basename(skillDir);
  const entries: ZipFile[] = files.map((f) => ({
    name: `${name}/${f}`,
    data: fs.readFileSync(path.join(skillDir, f)),
  }));

  return writeZip(entries);
}

function ghError(e: unknown): string {
  const err = e as NodeJS.ErrnoException & { stderr?: string };
  if (err.code === "ENOENT") {
    return "gh CLI is not installed. Install it from https://cli.github.com and run `gh auth login`.";
  }
  const stderr = err.stderr?.trim();

  return stderr
    ? stderr.split("\n").slice(-3).join(" ")
    : String(err.message ?? e);
}

function lastUrl(stdout: string): string {
  const urls = stdout.match(/https:\/\/\S+/g);
  if (!urls?.length) {
    throw "gh didn't say where it published the skill.";
  }

  return urls[urls.length - 1];
}

async function shareGist(
  skillDir: string,
  name: string,
  isPublic: boolean,
  description: string | null,
): Promise<string> {
  const files = shareableFiles(skillDir);
  checkSize(skillDir, files);
  // A gist has no folders; a skill with scripts or references needs a repository.
  if (files.some((f) => f.includes("/"))) {
    throw "A gist holds files but no folders, and this skill has folders. Publish it to a repository instead.";
  }
  const args = [
    "gist",
    "create",
    "--desc",
    description ? `${name}: ${description}` : name,
    ...(isPublic ? ["--public"] : []),
    "--",
    ...files,
  ];
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd: skillDir,
      timeout: 60_000,
    });

    return lastUrl(stdout);
  } catch (e) {
    throw typeof e === "string" ? e : ghError(e);
  }
}

async function shareRepo(
  skillDir: string,
  repoName: string,
  isPublic: boolean,
  description: string | null,
): Promise<string> {
  const problem = folderNameProblem(repoName);
  if (problem) {
    throw `That isn't a repository name. ${problem}`;
  }
  const files = shareableFiles(skillDir);
  checkSize(skillDir, files);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-skill-share-"));
  try {
    for (const f of files) {
      fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true });
      fs.copyFileSync(path.join(skillDir, f), path.join(tmp, f));
    }
    const git = (...args: string[]) =>
      execFileAsync("git", args, { cwd: tmp, timeout: 30_000 });
    await git("init", "-b", "main");
    await git("add", "-A");
    await git("commit", "-m", `Add the ${path.basename(skillDir)} skill`);
    const { stdout } = await execFileAsync(
      "gh",
      [
        "repo",
        "create",
        repoName,
        isPublic ? "--public" : "--private",
        ...(description ? ["--description", description.slice(0, 350)] : []),
        "--source",
        ".",
        "--push",
      ],
      { cwd: tmp, timeout: 120_000 },
    );

    return lastUrl(stdout).replace(/\.git$/, "");
  } catch (e) {
    throw typeof e === "string" ? e : ghError(e);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Writes the skill as a `.skill` file at `dest`, on this computer. */
export function exportSkill(
  skillPath: string,
  dest: string,
  env: SkillEnv = skillEnv(),
): { path: string } {
  knownSkill(skillPath, env);
  try {
    if (!path.isAbsolute(dest)) {
      throw "Choose where to save the file.";
    }
    fs.writeFileSync(dest, skillArchive(skillPath));
    telemetryCapture("skill_shared", {
      target: "file",
      public: false,
      success: true,
    });

    return { path: dest };
  } catch (e) {
    telemetryCapture("skill_shared", {
      target: "file",
      public: false,
      success: false,
    });
    throw typeof e === "string" ? e : `Couldn't save the file: ${String(e)}`;
  }
}

export async function shareSkill(
  input: SkillShareInput,
  env: SkillEnv = skillEnv(),
): Promise<SkillShareResult> {
  const { skill } = knownSkill(input.path, env);
  const props = { target: input.target, public: input.public };
  try {
    const url =
      input.target === "gist"
        ? await shareGist(
            input.path,
            skill.name,
            input.public,
            skill.description,
          )
        : await shareRepo(
            input.path,
            input.repo_name?.trim() || path.basename(input.path),
            input.public,
            skill.description,
          );
    info(`[skills] shared ${skill.name} as a ${input.target}`);
    telemetryCapture("skill_shared", { ...props, success: true });

    return { url };
  } catch (e) {
    telemetryCapture("skill_shared", { ...props, success: false });
    throw e;
  }
}
