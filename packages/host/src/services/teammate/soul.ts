/**
 * A teammate's persona: `SOUL.md`, plain markdown the user can edit here or
 * in any editor. Read fresh every time a prompt is built.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { teammateSoulPath } from "./paths";

export const MAX_SOUL_CHARS = 6_000;

export function readSoul(teammateId: string): string {
  try {
    return fs.readFileSync(teammateSoulPath(teammateId), "utf8").trim();
  } catch {
    return "";
  }
}

/** The soul as a prompt carries it: cut at the cap, never refused. */
export function soulForPrompt(teammateId: string): string {
  const soul = readSoul(teammateId);
  if (soul.length <= MAX_SOUL_CHARS) {
    return soul;
  }
  warn(`teammate ${teammateId}: SOUL.md is over ${MAX_SOUL_CHARS} characters`);

  return soul.slice(0, MAX_SOUL_CHARS);
}

export function writeSoul(teammateId: string, soul: string): void {
  const text = soul.trim();
  if (text.length > MAX_SOUL_CHARS) {
    throw `The soul is over ${MAX_SOUL_CHARS} characters — cut it down.`;
  }
  const filePath = teammateSoulPath(teammateId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, text ? `${text}\n` : "", "utf8");
  fs.renameSync(tmp, filePath);
}
