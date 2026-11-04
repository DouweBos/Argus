/**
 * The smallest value a zod schema accepts: empty lists, empty strings, zeros,
 * nulls where allowed. The fixture host answers every command a scenario
 * doesn't name with this, so the Mac app decodes it instead of failing the
 * screen over a call that has nothing to show anyway.
 */

import type { z } from "zod";

interface Def {
  type: string;
  [key: string]: unknown;
}

function defOf(schema: unknown): Def {
  return (schema as { _zod: { def: Def } })._zod.def;
}

export function synthesize(schema: z.ZodType, depth = 0): unknown {
  if (depth > 12) {
    return null;
  }
  const def = defOf(schema);
  const next = (inner: unknown) => synthesize(inner as z.ZodType, depth + 1);
  switch (def.type) {
    case "string":
    case "template_literal":
      return "";
    case "number":
    case "int":
    case "bigint":
      return 0;
    case "boolean":
      return false;
    case "date":
      return new Date(0).toISOString();
    case "null":
    case "nullable":
    case "undefined":
    case "void":
    case "any":
    case "unknown":
    case "never":
      return null;
    case "optional":
      return undefined;
    case "default":
    case "prefault": {
      const value = def.defaultValue;

      return typeof value === "function" ? (value as () => unknown)() : value;
    }
    case "array":
    case "set":
      return [];
    case "record":
    case "map":
      return {};
    case "tuple":
      return (def.items as unknown[]).map(next);
    case "enum":
      return Object.values(def.entries as Record<string, unknown>)[0];
    case "literal":
      return (def.values as unknown[])[0];
    case "union": {
      const options = def.options as z.ZodType[];
      // A nullable spelled as a union: null is the emptiest member.
      const nullable = options.find((o) => defOf(o).type === "null");

      return nullable ? null : next(options[0]);
    }
    case "intersection":
      return {
        ...(next(def.left) as object),
        ...(next(def.right) as object),
      };
    case "object": {
      const shape = def.shape as Record<string, z.ZodType>;
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(shape)) {
        const value = next(field);
        if (value !== undefined) {
          out[key] = value;
        }
      }

      return out;
    }
    case "pipe":
      return next(def.in);
    case "lazy":
      return next((def.getter as () => unknown)());
    case "readonly":
    case "catch":
    case "nonoptional":
    case "promise":
      return next(def.innerType);
    default:
      return null;
  }
}

/**
 * `value` with every field its schema requires and it lacks filled in from
 * `synthesize`. Fixture data written for an older shape keeps decoding after
 * the model grows a field, instead of the Mac app dropping the whole reply.
 */
export function conform(schema: z.ZodType, value: unknown, depth = 0): unknown {
  if (value === undefined || value === null || depth > 12) {
    return value === undefined ? synthesize(schema) : value;
  }
  const def = defOf(schema);
  const next = (inner: unknown, v: unknown) =>
    conform(inner as z.ZodType, v, depth + 1);
  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
    case "nonoptional":
      return next(def.innerType, value);
    case "lazy":
      return next((def.getter as () => unknown)(), value);
    case "pipe":
      return next(def.in, value);
    case "array":
      return Array.isArray(value)
        ? value.map((v) => next(def.element, v))
        : value;
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      const shape = def.shape as Record<string, z.ZodType>;
      const out: Record<string, unknown> = {
        ...(value as Record<string, unknown>),
      };
      for (const [key, field] of Object.entries(shape)) {
        const filled =
          key in out ? next(field, out[key]) : synthesize(field, depth + 1);
        if (filled !== undefined) {
          out[key] = filled;
        }
      }

      return out;
    }
    default:
      return value;
  }
}
