import { defineTypedCommand } from "../services/command/registry";
import {
  installSkill,
  removeSkill,
  updateSkill,
  viewSkills,
} from "../services/skills/install";

export function registerSkillCommands(): void {
  defineTypedCommand("skills_list", () => viewSkills());
  defineTypedCommand("skill_install", (p) => installSkill(p.input));
  defineTypedCommand("skill_update", (p) => updateSkill(p.path));
  defineTypedCommand("skill_remove", (p) => removeSkill(p.path));
}
