/**
 * The skills on disk. The runners report skills only as slash command names
 * once a CLI has started, without where they live or what they're for, so the
 * Skills screen reads the folders themselves.
 */

import type { SkillRoot } from "./roots";
import type { Skill } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { parseSkillFrontmatter } from "./frontmatter";
import { readManifest } from "./manifest";

export const SKILL_FILE = "SKILL.md";

/** Files under `dir`, skipping `.git`; capped so a huge folder can't stall the list. */
export function countFiles(dir: string, cap = 10_000): number {
  let count = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (count >= cap) {
        return;
      }
      if (e.isDirectory()) {
        if (e.name !== ".git") {
          walk(path.join(d, e.name));
        }
      } else if (e.isFile()) {
        count++;
      }
    }
  };
  walk(dir);

  return count;
}

/** The skill in `dir`, or null when it holds no SKILL.md. */
export function readSkill(dir: string, root: SkillRoot): Skill | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, SKILL_FILE), "utf8");
  } catch {
    return null;
  }
  const meta = parseSkillFrontmatter(text);

  return {
    path: dir,
    name: meta.name ?? path.basename(dir),
    description: meta.description,
    scope: root.scope,
    runner: root.runner,
    repo_root: root.repoRoot,
    project_name: root.repoRoot ? path.basename(root.repoRoot) : null,
    source: readManifest(dir),
    file_count: countFiles(dir),
  };
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** One skill per folder directly under the root; dot-folders are the runner's own. */
export function skillsIn(root: SkillRoot): Skill[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root.dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) {
      continue;
    }
    const dir = path.join(root.dir, e.name);
    // A linked skill folder counts; follow it once.
    if (!e.isDirectory() && !(e.isSymbolicLink() && isDirectory(dir))) {
      continue;
    }
    const skill = readSkill(dir, root);
    if (skill) {
      skills.push(skill);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverSkills(roots: SkillRoot[]): Skill[] {
  return roots.flatMap(skillsIn);
}
