import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";
import { teammateDir } from "../automation/paths";

export { teammateDir };

export function teammatesFilePath(): string {
  return path.join(argusHomeDir(), "teammates.json");
}

export function teammateSoulPath(teammateId: string): string {
  return path.join(teammateDir(teammateId), "SOUL.md");
}

/** Neutral working directory for the teammate's conversations. Not a repo. */
export function teammateHomeDir(teammateId: string): string {
  return path.join(teammateDir(teammateId), "home");
}
