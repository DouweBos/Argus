/**
 * An automation's memory, laid out like Claude Code's: a `MEMORY.md` index
 * linking one file per memory, each with `name`/`description`/`metadata.type`
 * frontmatter. The host rewrites the index on every change so it can't drift.
 */

import type { AutomationMemory, MemoryType, SaveMemoryInput } from "../models";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { MEMORY_TYPES } from "../models";
import { automationMemoryDir } from "../paths";

export const MEMORY_INDEX_FILE = "MEMORY.md";
export const MAX_MEMORIES = 100;
export const MAX_MEMORY_BODY_CHARS = 8_000;
export const MAX_MEMORY_DESCRIPTION_CHARS = 200;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function memoryPath(automationId: string, name: string): string {
  return path.join(automationMemoryDir(automationId), `${name}.md`);
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

export function listMemories(automationId: string): AutomationMemory[] {
  const dir = automationMemoryDir(automationId);
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
        warn(`automation ${automationId}: skipping unreadable memory ${entry}`);
        continue;
      }
      memories.push({ ...parsed, updated_at: fs.statSync(filePath).mtimeMs });
    } catch (e) {
      warn(
        `automation ${automationId}: could not read memory ${entry}: ${String(e)}`,
      );
    }
  }

  return memories.sort((a, b) => a.name.localeCompare(b.name));
}

export function getMemory(
  automationId: string,
  name: string,
): AutomationMemory | null {
  return listMemories(automationId).find((m) => m.name === name) ?? null;
}

export function buildMemoryIndex(memories: AutomationMemory[]): string {
  return memories
    .map((m) => `- [${m.name}](${m.name}.md) — ${m.description}`)
    .join("\n");
}

/** `MEMORY.md` as it is on disk, or null when the automation has no memories. */
export function readMemoryIndex(automationId: string): string | null {
  try {
    const text = fs
      .readFileSync(
        path.join(automationMemoryDir(automationId), MEMORY_INDEX_FILE),
        "utf8",
      )
      .trim();

    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function rewriteIndex(automationId: string): void {
  const indexPath = path.join(
    automationMemoryDir(automationId),
    MEMORY_INDEX_FILE,
  );
  const memories = listMemories(automationId);
  if (memories.length === 0) {
    fs.rmSync(indexPath, { force: true });
  } else {
    writeText(indexPath, `${buildMemoryIndex(memories)}\n`);
  }
  emitHostEvent("automation_memory:changed", { automation_id: automationId });
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw `Memory name must be a lowercase kebab-case slug (a-z, 0-9, -), got "${name}".`;
  }
}

export function saveMemory(
  automationId: string,
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
  const existing = listMemories(automationId);
  const isNew = !existing.some((m) => m.name === name);
  if (renaming && !isNew) {
    throw `A memory named "${name}" already exists.`;
  }
  if (isNew && !renaming && existing.length >= MAX_MEMORIES) {
    throw `This automation already has ${MAX_MEMORIES} memories — update or delete one instead.`;
  }

  writeText(
    memoryPath(automationId, name),
    serializeMemory({ name, description, type: input.type, body }),
  );
  if (renaming) {
    fs.rmSync(memoryPath(automationId, previous), { force: true });
  }
  rewriteIndex(automationId);

  return { name, description, type: input.type, body, updated_at: Date.now() };
}

export function deleteMemory(automationId: string, name: string): void {
  assertName(name);
  const filePath = memoryPath(automationId, name);
  if (!fs.existsSync(filePath)) {
    throw `No memory named "${name}".`;
  }
  fs.rmSync(filePath, { force: true });
  rewriteIndex(automationId);
}

export function deleteAllMemories(automationId: string): void {
  try {
    fs.rmSync(automationMemoryDir(automationId), {
      force: true,
      recursive: true,
    });
  } catch (e) {
    warn(`automation ${automationId}: could not remove memories: ${String(e)}`);
  }
}
