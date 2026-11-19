/**
 * The zod catalog in `@argus/remote-protocol` as JSON Schema, shared by the
 * Swift and Kotlin emitters in `gen-protocol.ts`. Exported schemas keep their
 * export name; anonymous nested objects are named after where they sit.
 */

import { z } from "zod";
import * as protocol from "@argus/remote-protocol";

export { protocol };

export interface JsonSchema {
  $ref?: string;
  additionalProperties?: JsonSchema | boolean;
  anyOf?: JsonSchema[];
  const?: unknown;
  default?: unknown;
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  prefixItems?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string[] | string;
}

const registry = z.registry<{ id: string }>();
export const nameOf = new Map<z.ZodType, string>();

function isSchema(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType;
}

function isStructural(schema: z.ZodType): boolean {
  const type = (schema as unknown as { def: { type: string } }).def.type;

  return (
    type === "object" ||
    type === "enum" ||
    type === "union" ||
    type === "record" ||
    type === "lazy"
  );
}

for (const [name, value] of Object.entries(protocol).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (!isSchema(value) || !isStructural(value) || nameOf.has(value)) {
    continue;
  }
  if (name === "NoParams") {
    continue;
  }
  nameOf.set(value, name);
  registry.add(value, { id: name });
}

export const MODEL_NAMES = new Set(nameOf.values());

export function toJson(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, {
    metadata: registry,
    unrepresentable: "any",
    io: "output",
    target: "draft-2020-12",
  }) as JsonSchema;
}

export function isVoid(schema: z.ZodType): boolean {
  return (schema as unknown as { def: { type: string } }).def.type === "void";
}

export function defsOf(json: JsonSchema): Record<string, JsonSchema> {
  return (json as { $defs?: Record<string, JsonSchema> }).$defs ?? {};
}

function words(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

export function pascal(raw: string): string {
  const out = words(raw)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");

  return /^[0-9]/.test(out) ? `_${out}` : out || "Value";
}

export function findDiscriminator(members: JsonSchema[]): string | null {
  const first = members[0]?.properties;
  if (!first || members.length < 2) {
    return null;
  }
  for (const key of Object.keys(first)) {
    if (
      members.every(
        (m) =>
          m.type === "object" &&
          m.properties?.[key]?.const !== undefined &&
          (m.required ?? []).includes(key),
      ) &&
      // A key every member pins to the same value (a version) tells nothing apart.
      new Set(members.map((m) => String(m.properties?.[key]?.const))).size ===
        members.length
    ) {
      return key;
    }
  }

  return null;
}

/**
 * A nullable schema with its null branch removed, or null when it isn't one.
 * zod writes a nullable scalar as `type: ["string", "null"]`.
 */
export function stripNull(schema: JsonSchema): JsonSchema | null {
  if (Array.isArray(schema.type) && schema.type.includes("null")) {
    const rest = schema.type.filter((t) => t !== "null");

    return rest.length === 1 ? { ...schema, type: rest[0] } : null;
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (!union || !union.some((s) => s.type === "null")) {
    return null;
  }
  const rest = union.filter((s) => s.type !== "null");
  if (rest.length === 1) {
    return rest[0];
  }

  return { ...schema, anyOf: rest, oneOf: undefined };
}
