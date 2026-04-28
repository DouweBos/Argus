export interface McpEntry {
  id: string;
  json: string;
  name: string;
}

export function newMcpEntryId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Parse a single entry's JSON, returning an error string when invalid. */
export function entryError(entry: McpEntry): string | null {
  if (!entry.name.trim()) {
    return "Name is required.";
  }
  try {
    const parsed = JSON.parse(entry.json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "Config must be a JSON object.";
    }
  } catch (e) {
    return `Invalid JSON: ${(e as Error).message}`;
  }

  return null;
}

/** Convert UI entries to the `{ [name]: config }` map written to disk. */
export function entriesToMap(
  entries: McpEntry[],
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const entry of entries) {
    if (entryError(entry) !== null) {
      continue;
    }
    out[entry.name.trim()] = JSON.parse(entry.json) as Record<string, unknown>;
  }

  return out;
}

/** Convert a stored `{ [name]: config }` map back into editable UI entries. */
export function mapToEntries(
  map: Record<string, Record<string, unknown>> | null | undefined,
): McpEntry[] {
  if (!map || typeof map !== "object") {
    return [];
  }

  return Object.entries(map).map(([name, config]) => ({
    id: newMcpEntryId(),
    name,
    json: JSON.stringify(config, null, 2),
  }));
}

/** Returns true when every entry parses successfully. */
export function entriesValid(entries: McpEntry[]): boolean {
  return entries.every((e) => entryError(e) === null);
}
