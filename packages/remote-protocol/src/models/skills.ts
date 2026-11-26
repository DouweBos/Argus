import { z } from "zod";

/** The runners that read skill folders: Claude Code and Codex. */
export const SkillRunner = z.enum(["claude-code", "codex"]);
export type SkillRunner = z.infer<typeof SkillRunner>;

/** `user`: every project on this computer; `project`: one repository, checked in. */
export const SkillScope = z.enum(["project", "user"]);
export type SkillScope = z.infer<typeof SkillScope>;

/** Where an installed skill came from. */
export const SkillSourceKind = z.enum(["archive", "folder", "gist", "git"]);
export type SkillSourceKind = z.infer<typeof SkillSourceKind>;

/** What Install records next to the skill, so Update can fetch it again. */
export const SkillSource = z.object({
  kind: SkillSourceKind,
  /** The repository or gist URL as given, or the folder or archive's path. */
  location: z.string(),
  /** The folder inside the repository the skill came from; null for its root. */
  subpath: z.string().nullable(),
  /** The branch or tag cloned; null for the default branch. */
  ref: z.string().nullable(),
  /** The commit installed, for git and gist sources. */
  commit: z.string().nullable(),
  installed_at: z.number(),
  updated_at: z.number(),
});
export type SkillSource = z.infer<typeof SkillSource>;

/** One skill folder holding a SKILL.md. */
export const Skill = z.object({
  /** Its folder, which also names it to Update, Remove and Share. */
  path: z.string(),
  /** The frontmatter `name`, else the folder's name. */
  name: z.string(),
  description: z.string().nullable(),
  scope: SkillScope,
  runner: SkillRunner,
  /** The project it belongs to, for project scope. */
  repo_root: z.string().nullable(),
  project_name: z.string().nullable(),
  /** Null when it wasn't installed through Argus. */
  source: SkillSource.nullable(),
  file_count: z.number().int(),
});
export type Skill = z.infer<typeof Skill>;

/** Which skills folder an install lands in. */
export const SkillTarget = z.object({
  scope: SkillScope,
  runner: SkillRunner,
  /** Required for project scope. */
  repo_root: z.string().nullable(),
});
export type SkillTarget = z.infer<typeof SkillTarget>;

/** `url`: a git repository, a GitHub folder link or a gist. `folder` and `archive` are paths on the computer. */
export const SkillInstallFrom = z.enum(["archive", "folder", "url"]);
export type SkillInstallFrom = z.infer<typeof SkillInstallFrom>;

export const SkillInstallInput = z.object({
  from: SkillInstallFrom,
  location: z.string(),
  /** A folder inside the repository holding the skill. */
  subpath: z.string().nullable(),
  target: SkillTarget,
  /** Replace a skill of the same name; without it the install stops at `exists`. */
  overwrite: z.boolean(),
});
export type SkillInstallInput = z.infer<typeof SkillInstallInput>;

export const SkillInstallResult = z.object({
  /** `exists`: a skill of that name is already there and nothing changed. */
  status: z.enum(["exists", "installed"]),
  name: z.string(),
  /** The installed skill; null when `exists`. */
  skill: Skill.nullable(),
});
export type SkillInstallResult = z.infer<typeof SkillInstallResult>;

export const SkillUpdateResult = z.object({
  skill: Skill,
  /** False when the source had nothing new. */
  changed: z.boolean(),
});
export type SkillUpdateResult = z.infer<typeof SkillUpdateResult>;
