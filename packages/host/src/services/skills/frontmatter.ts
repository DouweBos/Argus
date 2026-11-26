/** A SKILL.md's YAML frontmatter: the `name` and `description` the runners read. */

import YAML from "yaml";

export interface SkillFrontmatter {
  name: string | null;
  description: string | null;
}

export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) {
    return { name: null, description: null };
  }
  let data: unknown;
  try {
    data = YAML.parse(match[1]);
  } catch {
    return { name: null, description: null };
  }
  const fields = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;
  const clean = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null;

  return { name: clean(fields.name), description: clean(fields.description) };
}
