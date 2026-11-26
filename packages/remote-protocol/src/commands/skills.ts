import { z } from "zod";
import {
  Skill,
  SkillInstallInput,
  SkillInstallResult,
  SkillShareInput,
  SkillShareResult,
  SkillUpdateResult,
} from "../models/skills";
import { type CommandSpec, NoParams } from "./spec";

/** Skill folders the runners read: listed, installed, updated and removed. */
export const SKILL_COMMANDS = {
  skills_list: {
    tier: "admin",
    params: NoParams,
    result: z.object({ skills: z.array(Skill) }),
  },
  skill_install: {
    tier: "admin",
    params: z.object({ input: SkillInstallInput }),
    result: SkillInstallResult,
  },
  /** Fetches the recorded source again and replaces the folder's contents. */
  skill_update: {
    tier: "admin",
    params: z.object({ path: z.string() }),
    result: SkillUpdateResult,
  },
  skill_remove: {
    tier: "admin",
    params: z.object({ path: z.string() }),
    result: z.object({ removed: z.boolean() }),
  },
  /** Saves the skill as a `.skill` file on this computer. */
  skill_export: {
    tier: "admin",
    params: z.object({ path: z.string(), dest: z.string() }),
    result: z.object({ path: z.string() }),
  },
  /** Publishes it as a gist or a GitHub repository through `gh`. */
  skill_share: {
    tier: "admin",
    params: z.object({ input: SkillShareInput }),
    result: SkillShareResult,
  },
} as const satisfies Record<string, CommandSpec>;
