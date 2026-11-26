/**
 * Unpacking a `.skill` or `.zip` file. Every entry must stay inside the
 * destination: absolute names, drive letters and `..` refuse the whole
 * archive rather than skipping the entry.
 */

import fs from "node:fs";
import path from "node:path";
import { readZipEntry, zipEntries } from "../../lib/zip";

const MAX_ENTRIES = 2_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

/** The entry's path inside the archive, null for one to skip, or a thrown string for one that escapes. */
export function safeEntryPath(name: string): string | null {
  const normal = name.replace(/\\/g, "/");
  if (normal.endsWith("/")) {
    return null;
  }
  if (
    normal.startsWith("/") ||
    /^[A-Za-z]:/.test(normal) ||
    normal.includes("\0")
  ) {
    throw `The archive has a file outside its folder (${name}).`;
  }
  const parts = normal.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw `The archive has a file outside its folder (${name}).`;
  }
  // Finder's resource forks and .DS_Store files aren't part of the skill.
  if (
    parts[0] === "__MACOSX" ||
    parts.at(-1) === ".DS_Store" ||
    !parts.length
  ) {
    return null;
  }

  return parts.join("/");
}

/** Unpack `archive` into `dest`, which must not exist yet. Throws a readable string. */
export function extractSkillArchive(archive: string, dest: string): void {
  let bytes: Buffer;
  try {
    if (fs.statSync(archive).size > MAX_ARCHIVE_BYTES) {
      throw "too big";
    }
    bytes = fs.readFileSync(archive);
  } catch (e) {
    throw e === "too big"
      ? "That archive is over 50 MB, too big for a skill."
      : `Couldn't read ${path.basename(archive)}.`;
  }
  const entries = zipEntries(bytes);
  if (!entries) {
    throw `${path.basename(archive)} isn't a zip archive Argus can read.`;
  }
  if (entries.length > MAX_ENTRIES) {
    throw "That archive has too many files for a skill.";
  }
  // Check every name before writing anything.
  const planned = entries.flatMap((entry) => {
    const rel = safeEntryPath(entry.name);

    return rel ? [{ entry, rel }] : [];
  });
  let total = 0;
  for (const { entry } of planned) {
    total += entry.size;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw "That archive unpacks to over 50 MB, too big for a skill.";
  }

  fs.mkdirSync(dest, { recursive: true });
  const root = path.resolve(dest);
  for (const { entry, rel } of planned) {
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep)) {
      throw `The archive has a file outside its folder (${entry.name}).`;
    }
    const data = readZipEntry(bytes, entry, MAX_TOTAL_BYTES);
    if (!data) {
      throw `Couldn't unpack ${rel}; the archive may be damaged or encrypted.`;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}
