/**
 * Persisted OrgTask registry at `~/.argus/organization-tasks.json`.
 *
 * Survives app restarts. Schema is versioned for future migrations.
 */

import type { OrgTask } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { warn } from "../../../app/lib/logger";

const SCHEMA_VERSION = 1;

interface OrgTasksFile {
  version: number;
  tasks: OrgTask[];
}

export function orgTasksFilePath(): string {
  return path.join(os.homedir(), ".argus", "organization-tasks.json");
}

export function loadOrgTasks(): OrgTask[] {
  const filePath = orgTasksFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  let file: OrgTasksFile;
  try {
    file = JSON.parse(raw) as OrgTasksFile;
  } catch (e) {
    warn("Failed to parse organization-tasks.json:", e);

    return [];
  }

  if (file.version !== SCHEMA_VERSION || !Array.isArray(file.tasks)) {
    return [];
  }

  return file.tasks;
}

export function saveOrgTasks(tasks: OrgTask[]): void {
  const filePath = orgTasksFilePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const file: OrgTasksFile = { version: SCHEMA_VERSION, tasks };
  const json = JSON.stringify(file, null, 2);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, filePath);
}
