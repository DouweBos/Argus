/**
 * A memory directory, laid out like Claude Code's: a `MEMORY.md` index
 * linking one file per memory, each with `name`/`description`/`metadata.type`
 * frontmatter. The host rewrites the index on every change so it can't drift.
 * An automation owns one, or — when it belongs to a teammate — shares its
 * teammate's.
 */

import type {
  AutomationMemory,
  MemoryOwner,
  MemoryType,
  SaveMemoryInput,
} from "../models";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { MEMORY_TYPES } from "../models";
import { memoryDirFor } from "../paths";

export const MEMORY_INDEX_FILE = "MEMORY.md";
export const MAX_MEMORIES = 100;
export const MAX_MEMORY_BODY_CHARS = 8_000;
export const MAX_MEMORY_DESCRIPTION_CHARS = 200;
/** What of `MEMORY.md` a prompt inlines; past it the index is cut at a line. */
export const MAX_MEMORY_INDEX_CHARS = 12_000;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function memoryPath(owner: MemoryOwner, name: string): string {
  return path.join(memoryDirFor(owner), `${name}.md`);
}

function ownerLabel(owner: MemoryOwner): string {
  return `${owner.kind} ${owner.id}`;
}

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, filePath);
}

function isMemoryType(value: string): value is MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(value);
}

export function serializeMemory(
  memory: Omit<AutomationMemory, "updated_at">,
): string {
  return [
    "---",
    `name: ${memory.name}`,
    `description: ${memory.description}`,
    "metadata:",
    `  type: ${memory.type}`,
    "---",
    "",
    memory.body.trim(),
    "",
  ].join("\n");
}

/** Only the frontmatter we write; anything else makes the file unreadable. */
export function parseMemory(
  text: string,
): Omit<AutomationMemory, "updated_at"> | null {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(
    text.replace(/\r\n/g, "\n"),
  );
  if (!match) {
    return null;
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const field = /^\s*([a-z_]+):\s*(.*)$/.exec(line);
    if (field) {
      fields[field[1]] = field[2].trim();
    }
  }

  const { name, description, type } = fields;
  if (!name || !NAME_PATTERN.test(name) || !type || !isMemoryType(type)) {
    return null;
  }

  return { name, description: description ?? "", type, body: match[2].trim() };
}

export function listMemories(owner: MemoryOwner): AutomationMemory[] {
  const dir = memoryDirFor(owner);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const memories: AutomationMemory[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry === MEMORY_INDEX_FILE) {
      continue;
    }
    const filePath = path.join(dir, entry);
    try {
      const parsed = parseMemory(fs.readFileSync(filePath, "utf8"));
      if (!parsed || `${parsed.name}.md` !== entry) {
        warn(`${ownerLabel(owner)}: skipping unreadable memory ${entry}`);
        continue;
      }
      memories.push({ ...parsed, updated_at: fs.statSync(filePath).mtimeMs });
    } catch (e) {
      warn(
        `${ownerLabel(owner)}: could not read memory ${entry}: ${String(e)}`,
      );
    }
  }

  return memories.sort((a, b) => a.name.localeCompare(b.name));
}

export function getMemory(
  owner: MemoryOwner,
  name: string,
): AutomationMemory | null {
  return listMemories(owner).find((m) => m.name === name) ?? null;
}

export function buildMemoryIndex(memories: AutomationMemory[]): string {
  return memories
    .map((m) => `- [${m.name}](${m.name}.md) — ${m.description}`)
    .join("\n");
}

/** `MEMORY.md` as it is on disk, or null when there are no memories. */
export function readMemoryIndex(owner: MemoryOwner): string | null {
  try {
    const text = fs
      .readFileSync(path.join(memoryDirFor(owner), MEMORY_INDEX_FILE), "utf8")
      .trim();

    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function rewriteIndex(owner: MemoryOwner): void {
  const indexPath = path.join(memoryDirFor(owner), MEMORY_INDEX_FILE);
  const memories = listMemories(owner);
  if (memories.length === 0) {
    fs.rmSync(indexPath, { force: true });
  } else {
    writeText(indexPath, `${buildMemoryIndex(memories)}\n`);
  }
  emitHostEvent("automation_memory:changed", { owner });
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw `Memory name must be a lowercase kebab-case slug (a-z, 0-9, -), got "${name}".`;
  }
}

export function saveMemory(
  owner: MemoryOwner,
  input: SaveMemoryInput,
): AutomationMemory {
  const name = input.name.trim();
  const description = input.description.trim();
  const body = input.body.trim();
  assertName(name);
  if (!isMemoryType(input.type)) {
    throw `Memory type must be one of ${MEMORY_TYPES.join(", ")}.`;
  }
  if (!description || description.includes("\n")) {
    throw "Memory description must be a single, non-empty line.";
  }
  if (description.length > MAX_MEMORY_DESCRIPTION_CHARS) {
    throw `Memory description is over ${MAX_MEMORY_DESCRIPTION_CHARS} characters.`;
  }
  if (!body) {
    throw "Memory body is empty.";
  }
  if (body.length > MAX_MEMORY_BODY_CHARS) {
    throw `Memory body is over ${MAX_MEMORY_BODY_CHARS} characters — split it or cut it down.`;
  }

  const previous = input.previous_name?.trim() || null;
  if (previous) {
    assertName(previous);
  }
  const renaming = previous !== null && previous !== name;
  const existing = listMemories(owner);
  const isNew = !existing.some((m) => m.name === name);
  if (renaming && !isNew) {
    throw `A memory named "${name}" already exists.`;
  }
  if (isNew && !renaming && existing.length >= MAX_MEMORIES) {
    throw `There are already ${MAX_MEMORIES} memories — update or delete one instead.`;
  }

  writeText(
    memoryPath(owner, name),
    serializeMemory({ name, description, type: input.type, body }),
  );
  if (renaming) {
    fs.rmSync(memoryPath(owner, previous), { force: true });
  }
  rewriteIndex(owner);

  return { name, description, type: input.type, body, updated_at: Date.now() };
}

export function deleteMemory(owner: MemoryOwner, name: string): void {
  assertName(name);
  const filePath = memoryPath(owner, name);
  if (!fs.existsSync(filePath)) {
    throw `No memory named "${name}".`;
  }
  fs.rmSync(filePath, { force: true });
  rewriteIndex(owner);
}

export function deleteAllMemories(owner: MemoryOwner): void {
  try {
    fs.rmSync(memoryDirFor(owner), { force: true, recursive: true });
  } catch (e) {
    warn(`${ownerLabel(owner)}: could not remove memories: ${String(e)}`);
  }
}
