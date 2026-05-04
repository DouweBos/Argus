/**
 * Persisted organization registry at `~/.argus/organizations.json`.
 *
 * Survives app restarts. Schema is versioned so future migrations can drop or
 * rewrite malformed state without data loss on unrelated fields.
 */

import type { Organization } from "./models";
import fs from "node:fs";
import path from "node:path";
import { warn } from "../../../app/lib/logger";
import { argusHomeDir } from "../../lib/argusHome";

const SCHEMA_VERSION = 1;

interface OrganizationsFile {
  version: number;
  organizations: Organization[];
}

/** Absolute path to the organizations registry file. */
export function organizationsFilePath(): string {
  return path.join(argusHomeDir(), "organizations.json");
}

/**
 * Load organizations from disk. Returns an empty array if the file is missing,
 * malformed, or from an unsupported schema version.
 */
export function loadOrganizations(): Organization[] {
  const filePath = organizationsFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  let file: OrganizationsFile;
  try {
    file = JSON.parse(raw) as OrganizationsFile;
  } catch (e) {
    warn("Failed to parse organizations.json:", e);

    return [];
  }

  if (file.version !== SCHEMA_VERSION || !Array.isArray(file.organizations)) {
    return [];
  }

  return file.organizations;
}

/** Write the full list of organizations to disk, atomically. */
export function saveOrganizations(orgs: Organization[]): void {
  const filePath = organizationsFilePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const file: OrganizationsFile = {
    version: SCHEMA_VERSION,
    organizations: orgs,
  };
  const json = JSON.stringify(file, null, 2);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, filePath);
}
