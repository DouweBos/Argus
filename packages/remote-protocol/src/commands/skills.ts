import { z } from "zod";
import {
  Skill,
  SkillInstallInput,
  SkillInstallResult,
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
} as const satisfies Record<string, CommandSpec>;
