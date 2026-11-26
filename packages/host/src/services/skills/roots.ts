/**
 * The folders each runner reads skills from. Claude Code: `~/.claude/skills`
 * and `<repo>/.claude/skills` (every Argus account links the shared one).
 * Codex: `$CODEX_HOME/skills` and `<repo>/.codex/skills`.
 */

import type { SkillRunner, SkillScope } from "@argus/remote-protocol";
import os from "node:os";
import path from "node:path";

export interface SkillRoot {
  dir: string;
  runner: SkillRunner;
  scope: SkillScope;
  repoRoot: string | null;
}

export interface SkillHomes {
  home: string;
  codexHome: string;
}

export function skillHomes(env: NodeJS.ProcessEnv = process.env): SkillHomes {
  const home = os.homedir();

  return {
    home,
    codexHome: env.CODEX_HOME?.trim() || path.join(home, ".codex"),
  };
}

const PROJECT_DIRS: Record<SkillRunner, string> = {
  "claude-code": ".claude",
  codex: ".codex",
};

export function skillRoot(
  runner: SkillRunner,
  scope: SkillScope,
  repoRoot: string | null,
  homes: SkillHomes = skillHomes(),
): SkillRoot {
  if (scope === "project") {
    if (!repoRoot) {
      throw "Pick a project for a project skill.";
    }

    return {
      dir: path.join(repoRoot, PROJECT_DIRS[runner], "skills"),
      runner,
      scope,
      repoRoot,
    };
  }
  const dir =
    runner === "codex"
      ? path.join(homes.codexHome, "skills")
      : path.join(homes.home, ".claude", "skills");

  return { dir, runner, scope, repoRoot: null };
}

/** Every skills folder there is: both runners' user folders, then each project's. */
export function allSkillRoots(
  repoRoots: Iterable<string>,
  homes: SkillHomes = skillHomes(),
): SkillRoot[] {
  const runners: SkillRunner[] = ["claude-code", "codex"];
  const roots = runners.map((r) => skillRoot(r, "user", null, homes));
  for (const repoRoot of [...repoRoots].sort()) {
    for (const runner of runners) {
      roots.push(skillRoot(runner, "project", repoRoot, homes));
    }
  }

  return roots;
}
