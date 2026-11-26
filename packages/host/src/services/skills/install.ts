/**
 * Installing a skill from a git URL, a gist, a folder or a `.skill`/`.zip`
 * file into a runner's skills folder, and updating or removing it again.
 */

import type {
  Skill,
  SkillInstallInput,
  SkillInstallResult,
  SkillSource,
  SkillSourceKind,
  SkillUpdateResult,
} from "@argus/remote-protocol";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { info } from "@argus/host/logger";
import { appState } from "../../state";
import { ghAvailable } from "../clone/jobs";
import { runClone } from "../clone/run";
import { cloneCommand, folderNameProblem } from "../clone/url";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { extractSkillArchive } from "./archive";
import { discoverSkills, readSkill, SKILL_FILE } from "./discover";
import { parseSkillFrontmatter } from "./frontmatter";
import { MANIFEST_FILE, readManifest, writeManifest } from "./manifest";
import {
  allSkillRoots,
  type SkillHomes,
  skillHomes,
  type SkillRoot,
  skillRoot,
} from "./roots";
import { normalizeSubpath, parseSkillUrl } from "./sourceUrl";

const execFileAsync = promisify(execFile);

/** Where skills live; tests point it at temp folders. */
export interface SkillEnv {
  homes: SkillHomes;
  repoRoots: () => Iterable<string>;
}

const realEnv = (): SkillEnv => ({
  homes: skillHomes(),
  repoRoots: () => appState.repoRoots,
});

export function listSkills(env: SkillEnv = realEnv()): Skill[] {
  return discoverSkills(allSkillRoots(env.repoRoots(), env.homes));
}

function countBucket(n: number): "0" | "1-5" | "6-20" | "21+" {
  if (n === 0) {
    return "0";
  }
  if (n <= 5) {
    return "1-5";
  }

  return n <= 20 ? "6-20" : "21+";
}

/** The list, counted for the Skills screen. */
export function viewSkills(): { skills: Skill[] } {
  const skills = listSkills();
  telemetryCapture("skills_viewed", {
    count_bucket: countBucket(skills.length),
    installed_count: skills.filter((s) => s.source).length,
  });

  return { skills };
}

interface Staged {
  /** The folder holding the source's files (before finding its SKILL.md). */
  dir: string;
  kind: SkillSourceKind;
  subpath: string | null;
  ref: string | null;
  commit: string | null;
  /** A folder name for a skill whose frontmatter has none. */
  fallbackName: string;
  cleanup: () => void;
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "argus-skill-"));
}

async function headCommit(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      timeout: 10_000,
    });

    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function stage(
  from: SkillInstallInput["from"],
  location: string,
  rawSubpath: string | null,
): Promise<Staged> {
  if (from === "url") {
    const parsed = parseSkillUrl(location, rawSubpath);
    const tmp = tempDir();
    const cleanup = (): void =>
      fs.rmSync(tmp, { recursive: true, force: true });
    const dest = path.join(tmp, "src");
    try {
      if (parsed.kind === "gist") {
        await runClone({
          program: "git",
          args: ["clone", "--depth", "1", "--", parsed.cloneUrl, dest],
          dest,
        });
      } else {
        const gh = parsed.source.kind === "shorthand" && (await ghAvailable());
        await runClone({
          ...cloneCommand(parsed.source, dest, {
            gh,
            depth: 1,
            branch: parsed.ref ?? undefined,
          }),
          dest,
        });
      }
    } catch (e) {
      cleanup();
      throw e;
    }
    const commit = await headCommit(dest);
    if (parsed.kind === "gist") {
      return {
        dir: dest,
        kind: "gist",
        subpath: null,
        ref: null,
        commit,
        fallbackName: `gist-${parsed.id.slice(0, 8)}`,
        cleanup,
      };
    }
    const sub = parsed.subpath;

    return {
      dir: sub ? path.join(dest, sub) : dest,
      kind: "git",
      subpath: sub,
      ref: parsed.ref,
      commit,
      fallbackName: sub ? path.basename(sub) : parsed.source.repoName,
      cleanup,
    };
  }

  if (!path.isAbsolute(location)) {
    throw "Choose the folder or file on this computer.";
  }
  if (from === "folder") {
    const sub = normalizeSubpath(rawSubpath);
    const dir = sub ? path.join(location, sub) : location;
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      throw `${location} isn't a folder.`;
    }

    return {
      dir,
      kind: "folder",
      subpath: sub,
      ref: null,
      commit: null,
      fallbackName: path.basename(dir),
      cleanup: () => {},
    };
  }

  const tmp = tempDir();
  const cleanup = (): void => fs.rmSync(tmp, { recursive: true, force: true });
  const dest = path.join(tmp, "src");
  try {
    extractSkillArchive(location, dest);
  } catch (e) {
    cleanup();
    throw e;
  }

  return {
    dir: dest,
    kind: "archive",
    subpath: null,
    ref: null,
    commit: null,
    fallbackName: path.basename(location).replace(/\.(skill|zip)$/i, ""),
    cleanup,
  };
}

function hasSkillFile(dir: string): boolean {
  return (
    fs
      .statSync(path.join(dir, SKILL_FILE), { throwIfNoEntry: false })
      ?.isFile() === true
  );
}

function childDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() && !e.name.startsWith(".") && e.name !== "__MACOSX",
      )
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * The folder with the SKILL.md: the source itself, else the one skill one or
 * two levels down (an archive's wrapper folder, a repository's `skills/x`).
 */
export function findSkillDir(base: string): string {
  if (hasSkillFile(base)) {
    return base;
  }
  const found: string[] = [];
  for (const child of childDirs(base)) {
    if (hasSkillFile(child)) {
      found.push(child);
      continue;
    }
    found.push(...childDirs(child).filter(hasSkillFile));
  }
  if (found.length === 1) {
    return found[0];
  }
  if (found.length > 1) {
    const names = found.map((f) => path.relative(base, f));
    const shown = names.slice(0, 5).join(", ");
    throw `That holds ${found.length} skills (${shown}${names.length > 5 ? ", and more" : ""}). Enter the folder of the one to install as its path.`;
  }

  throw "There's no SKILL.md there, so it isn't a skill.";
}

/** The folder name: the frontmatter's `name` when it makes one, else the source's. */
export function skillFolderName(skillDir: string, fallback: string): string {
  const meta = parseSkillFrontmatter(
    fs.readFileSync(path.join(skillDir, SKILL_FILE), "utf8"),
  );
  for (const candidate of [meta.name, fallback]) {
    const name = candidate?.trim().replace(/\s+/g, "-") ?? "";
    if (name && folderNameProblem(name) === null) {
      return name;
    }
  }

  throw "The skill has no name Argus can use as a folder; give its SKILL.md a `name`.";
}

/** Copies the skill's files, leaving out `.git`, links and an old manifest. */
function copySkill(src: string, dst: string): void {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (from) => {
      const base = path.basename(from);
      if (from !== src && (base === ".git" || base === MANIFEST_FILE)) {
        return false;
      }

      return !fs.lstatSync(from).isSymbolicLink();
    },
  });
}

/** Swap the new copy in beside the old one, so a failed copy leaves the old skill. */
function place(src: string, dest: string): void {
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  const incoming = path.join(
    parent,
    `.${path.basename(dest)}.installing-${crypto.randomUUID().slice(0, 8)}`,
  );
  try {
    copySkill(src, incoming);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(incoming, dest);
  } catch (e) {
    fs.rmSync(incoming, { recursive: true, force: true });
    throw e instanceof Error ? `Couldn't write the skill: ${e.message}` : e;
  }
}

function resolveTarget(input: SkillInstallInput, env: SkillEnv): SkillRoot {
  const { scope, runner, repo_root } = input.target;
  if (scope === "project") {
    if (!repo_root || ![...env.repoRoots()].includes(repo_root)) {
      throw "Pick one of your projects for a project skill.";
    }
  }

  return skillRoot(runner, scope, repo_root, env.homes);
}

function guessKind(input: SkillInstallInput): SkillSourceKind {
  if (input.from !== "url") {
    return input.from;
  }
  try {
    return parseSkillUrl(input.location, input.subpath).kind;
  } catch {
    return "git";
  }
}

export async function installSkill(
  input: SkillInstallInput,
  env: SkillEnv = realEnv(),
): Promise<SkillInstallResult> {
  const props = {
    source_kind: guessKind(input),
    scope: input.target.scope,
    runner: input.target.runner,
  };
  try {
    const result = await install(input, env);
    if (result.status === "installed") {
      telemetryCapture("skill_installed", {
        ...props,
        overwrote: input.overwrite,
        success: true,
      });
    }

    return result;
  } catch (e) {
    telemetryCapture("skill_installed", {
      ...props,
      overwrote: input.overwrite,
      success: false,
    });
    throw e;
  }
}

async function install(
  input: SkillInstallInput,
  env: SkillEnv,
): Promise<SkillInstallResult> {
  const root = resolveTarget(input, env);
  const location = input.location.trim();
  if (!location) {
    throw input.from === "url"
      ? "Enter a git or gist URL."
      : "Choose what to install.";
  }
  const staged = await stage(input.from, location, input.subpath);
  try {
    const skillDir = findSkillDir(staged.dir);
    const name = skillFolderName(
      skillDir,
      skillDir === staged.dir ? staged.fallbackName : path.basename(skillDir),
    );
    const dest = path.join(root.dir, name);
    if (fs.existsSync(dest) && !input.overwrite) {
      return { status: "exists", name, skill: null };
    }
    place(skillDir, dest);
    const now = Date.now();
    writeManifest(dest, {
      kind: staged.kind,
      location,
      subpath: staged.subpath,
      ref: staged.ref,
      commit: staged.commit,
      installed_at: now,
      updated_at: now,
    });
    info(`[skills] installed ${name} into ${root.dir}`);
    const skill = readSkill(dest, root);
    if (!skill) {
      throw "The skill was copied but its SKILL.md can't be read.";
    }

    return { status: "installed", name, skill };
  } finally {
    staged.cleanup();
  }
}

/** A skill the list shows, so a path can't name some other folder. */
function knownSkill(
  skillPath: string,
  env: SkillEnv,
): { skill: Skill; root: SkillRoot } {
  for (const root of allSkillRoots(env.repoRoots(), env.homes)) {
    if (path.dirname(skillPath) !== root.dir) {
      continue;
    }
    const skill = readSkill(skillPath, root);
    if (skill) {
      return { skill, root };
    }
  }

  throw "That skill isn't there anymore.";
}

const FROM: Record<SkillSourceKind, SkillInstallInput["from"]> = {
  archive: "archive",
  folder: "folder",
  gist: "url",
  git: "url",
};

export async function updateSkill(
  skillPath: string,
  env: SkillEnv = realEnv(),
): Promise<SkillUpdateResult> {
  const { root } = knownSkill(skillPath, env);
  const source = readManifest(skillPath);
  if (!source) {
    throw "This skill wasn't installed through Argus, so there's nothing to update it from.";
  }
  try {
    const result = await update(skillPath, root, source);
    telemetryCapture("skill_updated", {
      source_kind: source.kind,
      changed: result.changed,
      success: true,
    });

    return result;
  } catch (e) {
    telemetryCapture("skill_updated", {
      source_kind: source.kind,
      changed: false,
      success: false,
    });
    throw e;
  }
}

async function update(
  skillPath: string,
  root: SkillRoot,
  source: SkillSource,
): Promise<SkillUpdateResult> {
  const staged = await stage(
    FROM[source.kind],
    source.location,
    source.subpath,
  );
  try {
    const skillDir = findSkillDir(staged.dir);
    const changed = !(source.commit && staged.commit === source.commit);
    if (changed) {
      place(skillDir, skillPath);
    }
    writeManifest(skillPath, {
      ...source,
      ref: staged.ref,
      commit: staged.commit,
      updated_at: Date.now(),
    });
    const skill = readSkill(skillPath, root);
    if (!skill) {
      throw "The update has no SKILL.md.";
    }

    return { skill, changed };
  } finally {
    staged.cleanup();
  }
}

export function removeSkill(
  skillPath: string,
  env: SkillEnv = realEnv(),
): { removed: boolean } {
  const { skill } = knownSkill(skillPath, env);
  fs.rmSync(skillPath, { recursive: true, force: true });
  info(`[skills] removed ${skill.name} from ${path.dirname(skillPath)}`);
  telemetryCapture("skill_removed", {
    scope: skill.scope,
    runner: skill.runner,
    installed: skill.source !== null,
  });

  return { removed: true };
}
