/**
 * `.argus-skill.json` inside an installed skill's folder: where it came from,
 * so Update can fetch it again. It travels with the folder (a project skill's
 * is checked in with it), and Share leaves it out.
 */

import {
  SkillSource,
  type SkillSource as SkillSourceT,
} from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";

export const MANIFEST_FILE = ".argus-skill.json";

export function readManifest(skillDir: string): SkillSourceT | null {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(skillDir, MANIFEST_FILE), "utf8"),
    );
    const parsed = SkillSource.safeParse(raw);

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeManifest(skillDir: string, source: SkillSourceT): void {
  fs.writeFileSync(
    path.join(skillDir, MANIFEST_FILE),
    `${JSON.stringify(source, null, 2)}\n`,
    "utf8",
  );
}
