/**
 * The Kotlin half of `gen-protocol.ts`: kotlinx.serialization wire types for
 * the Android kit, shaped like the Swift ones so the two clients port 1:1.
 *
 * Objects become data classes, string enums value classes that keep unknown
 * values, discriminated unions sealed interfaces with an `Unknown` fallback.
 */

import type { z } from "zod";
import {
  defsOf,
  findDiscriminator,
  isVoid,
  type JsonSchema,
  MODEL_NAMES,
  nameOf,
  pascal,
  protocol,
  stripNull,
  toJson,
} from "./protocol-catalog";

const PACKAGE = "dev.houwert.argus.kit.protocol.generated";

const KOTLIN_KEYWORDS = new Set([
  "as",
  "break",
  "class",
  "continue",
  "do",
  "else",
  "false",
  "for",
  "fun",
  "if",
  "in",
  "interface",
  "is",
  "null",
  "object",
  "package",
  "return",
  "super",
  "this",
  "throw",
  "true",
  "try",
  "typealias",
  "typeof",
  "val",
  "var",
  "when",
  "while",
]);

function camel(raw: string): string {
  const p = pascal(raw);
  const out = p[0].toLowerCase() + p.slice(1);

  return KOTLIN_KEYWORDS.has(out) ? `\`${out}\`` : out;
}

/** A Kotlin string literal: JSON escaping plus `$`, which would template. */
function ktString(value: string): string {
  return JSON.stringify(value).replace(/\$/g, "\\$");
}

function kdoc(text: string | undefined, indent: string): string {
  if (!text) {
    return "";
  }
  const lines = text.replace(/\*\//g, "*&#47;").split("\n");
  if (lines.length === 1) {
    return `${indent}/** ${lines[0]} */\n`;
  }

  return (
    `${indent}/**\n` +
    lines.map((l) => `${indent} * ${l}`.trimEnd()).join("\n") +
    `\n${indent} */\n`
  );
}

const JSON_ELEMENT = "JsonElement";

class Emitter {
  private readonly decls: string[] = [];
  private readonly emitted = new Set<string>();
  readonly declared = new Set<string>();

  constructor(
    private readonly defs: Record<string, JsonSchema> = {},
    private readonly root = JSON_ELEMENT,
  ) {}

  output(): string {
    return this.decls.join("\n");
  }

  append(other: Emitter): void {
    const out = other.output();
    if (out) {
      this.decls.push(out);
    }
    for (const name of [...other.emitted, ...other.declared]) {
      this.declared.add(name);
    }
  }

  typeFor(schema: JsonSchema, context: string): string {
    if (schema.$ref) {
      return this.refName(schema.$ref);
    }
    const nullable = stripNull(schema);
    if (nullable) {
      const inner = this.typeFor(nullable, context);

      return inner.endsWith("?") ? inner : `${inner}?`;
    }
    if (schema.enum && schema.enum.every((v) => typeof v === "string")) {
      return this.declareEnum(context, schema.enum as string[], schema);
    }
    if (schema.const !== undefined) {
      return ktScalar(typeof schema.const);
    }
    const union = schema.oneOf ?? schema.anyOf;
    if (union) {
      return this.declareUnion(context, union, schema);
    }
    switch (schema.type) {
      case "string":
        return "String";
      case "integer":
        return "Long";
      case "number":
        return "Double";
      case "boolean":
        return "Boolean";
      case "null":
        return JSON_ELEMENT;
      case "array":
        if (schema.prefixItems) {
          return `List<${JSON_ELEMENT}>`;
        }

        return `List<${schema.items ? this.typeFor(schema.items, `${context}Item`) : JSON_ELEMENT}>`;
      case "object": {
        const extra = schema.additionalProperties;
        if (!schema.properties && extra && typeof extra === "object") {
          return `Map<String, ${this.typeFor(extra, `${context}Value`)}>`;
        }
        if (!schema.properties) {
          return `Map<String, ${JSON_ELEMENT}>`;
        }

        return this.declareStruct(context, schema);
      }
      default:
        return JSON_ELEMENT;
    }
  }

  declareNamed(name: string, schema: JsonSchema): string {
    const type = this.typeFor(schema, name);
    if (type !== name && !this.emitted.has(name)) {
      this.emitted.add(name);
      this.decls.push(
        `${kdoc(schema.description, "")}typealias ${name} = ${type}\n`,
      );
    }

    return name;
  }

  private refName(ref: string): string {
    if (ref === "#") {
      return this.root;
    }
    const name = ref.replace(/^#\/\$defs\//, "");
    const def = this.defs[name];
    if (def && !this.emitted.has(name) && !MODEL_NAMES.has(name)) {
      this.declareNamed(name, def);
    }

    return name;
  }

  private declareStruct(name: string, schema: JsonSchema): string {
    if (this.emitted.has(name)) {
      return name;
    }
    this.emitted.add(name);
    const required = new Set(schema.required ?? []);
    const used = new Set<string>();
    const fields = Object.entries(schema.properties ?? {}).map(
      ([key, prop]) => {
        let ktName = camel(key);
        while (used.has(ktName)) {
          ktName = ktName.endsWith("`")
            ? `${ktName.slice(0, -1)}_\``
            : `${ktName}_`;
        }
        used.add(ktName);
        const optional = !required.has(key) || prop.default !== undefined;
        let type = this.typeFor(prop, `${name}${pascal(key)}`);
        const nullable = type.endsWith("?");
        if (optional && !nullable) {
          type = `${type}?`;
        }

        return { key, ktName, type, optional, nullable, doc: prop.description };
      },
    );

    const lines: string[] = [];
    const doc = kdoc(schema.description, "").trimEnd();
    if (doc) {
      lines.push(doc);
    }
    lines.push("@Serializable");
    if (fields.length === 0) {
      lines.push(`class ${name}`);
      this.decls.push(lines.join("\n") + "\n");

      return name;
    }
    lines.push(`data class ${name}(`);
    for (const f of fields) {
      const d = kdoc(f.doc, "  ");
      const annotations = [`@SerialName(${ktString(f.key)})`];
      // Nil in a required-but-nullable field must still go out as `null`.
      if (f.nullable && !f.optional) {
        annotations.push("@EncodeDefault");
      }
      const dflt = f.type.endsWith("?") ? " = null" : "";
      lines.push(
        `${d}  ${annotations.join(" ")} val ${f.ktName}: ${f.type}${dflt},`,
      );
    }
    lines.push(")");
    this.decls.push(lines.join("\n") + "\n");

    return name;
  }

  /** A newer host adding a case never breaks an older client. */
  private declareEnum(
    name: string,
    values: string[],
    schema: JsonSchema,
  ): string {
    if (this.emitted.has(name)) {
      return name;
    }
    this.emitted.add(name);
    const used = new Set<string>();
    const cases = values.map((v) => {
      let c = camel(v).replace(/`/g, "");
      if (KOTLIN_KEYWORDS.has(c) || c === "rawValue" || c === "entries") {
        c = `${c}_`;
      }
      while (used.has(c)) {
        c = `${c}_`;
      }
      used.add(c);

      return `    val ${c} = ${name}(${ktString(v)})`;
    });
    this.decls.push(
      `${kdoc(schema.description, "")}@Serializable
@JvmInline
value class ${name}(val rawValue: String) {
  override fun toString(): String = rawValue

  companion object {
${cases.join("\n")}
    val entries: List<${name}> = listOf(${used.size > 0 ? [...used].join(", ") : ""})
  }
}
`,
    );

    return name;
  }

  private declareUnion(
    name: string,
    members: JsonSchema[],
    schema: JsonSchema,
  ): string {
    const discriminator = findDiscriminator(members);
    if (!discriminator) {
      if (members.every((m) => m.type === "string")) {
        return "String";
      }

      return JSON_ELEMENT;
    }
    if (this.emitted.has(name)) {
      return name;
    }
    this.emitted.add(name);
    const usedCases = new Set<string>(["Unknown"]);
    const cases = members.map((m) => {
      const resolved = m.$ref
        ? this.defs[m.$ref.replace(/^#\/\$defs\//, "")]
        : m;
      const tag = String(resolved?.properties?.[discriminator]?.const);
      const payload = this.typeFor(m, `${name}${pascal(tag)}`);
      let caseName = pascal(tag);
      while (usedCases.has(caseName) || caseName === payload) {
        caseName = `${caseName}Case`;
      }
      usedCases.add(caseName);

      return { tag, caseName, payload };
    });
    this.decls.push(
      `${kdoc(schema.description, "")}@Serializable(with = ${name}.Serializer::class)
sealed interface ${name} {
${cases.map((c) => `  data class ${c.caseName}(val value: ${c.payload}) : ${name}`).join("\n")}
  data class Unknown(val value: JsonElement) : ${name}

  object Serializer : TaggedUnionSerializer<${name}>(${ktString(name)}, ${ktString(discriminator)}) {
    override fun decode(json: Json, tag: String?, element: JsonElement): ${name} = when (tag) {
${cases.map((c) => `      ${ktString(c.tag)} -> ${c.caseName}(json.decodeFromJsonElement(element))`).join("\n")}
      else -> Unknown(element)
    }

    override fun encode(json: Json, value: ${name}): JsonElement = when (value) {
${cases.map((c) => `      is ${c.caseName} -> json.encodeToJsonElement(value.value)`).join("\n")}
      is Unknown -> value.value
    }
  }
}
`,
    );

    return name;
  }
}

function ktScalar(kind: string): string {
  switch (kind) {
    case "number":
      return "Double";
    case "boolean":
      return "Boolean";
    default:
      return "String";
  }
}

const HEADER = `// Generated by scripts/gen-protocol.ts from @argus/remote-protocol.
// Do not edit — run \`pnpm gen:protocol\`.
@file:OptIn(ExperimentalSerializationApi::class)
@file:Suppress("unused", "RedundantVisibilityModifier", "ClassName", "PropertyName", "EnumEntryName")

package ${PACKAGE}

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import dev.houwert.argus.kit.protocol.TaggedUnionSerializer
`;

function rootType(
  emitter: Emitter,
  schema: z.ZodType,
  fallbackName: string,
): string {
  if (isVoid(schema)) {
    return "IgnoredResult";
  }
  if (schema === protocol.NoParams) {
    return "EmptyParams";
  }
  const named = nameOf.get(schema);
  if (named) {
    return named;
  }
  const json = toJson(schema);
  const scoped = new Emitter(defsOf(json), fallbackName);
  const type = scoped.typeFor(json, fallbackName);
  emitter.append(scoped);

  return type;
}

function modelsFile(): string {
  const emitter = new Emitter();
  for (const [schema, name] of [...nameOf].sort(([, a], [, b]) =>
    a.localeCompare(b),
  )) {
    const json = toJson(schema);
    const defs = defsOf(json);
    const body = json.$ref === `#/$defs/${name}` ? defs[name] : json;
    const scoped = new Emitter(defs, name);
    scoped.declareNamed(name, body);
    emitter.append(scoped);
  }

  return `${HEADER}
${emitter.output()}`;
}

const BUILTINS =
  /^(String|Long|Double|Boolean|JsonElement|IgnoredResult|EmptyParams|List|Map)$/;

/**
 * Inline types live in `<Family>Types`, so a raw command and a typed method
 * that pascal-case alike never collide, and one a family declared itself wins
 * over a model of the same name.
 */
function qualify(type: string, family: string, local: Emitter): string {
  return type.replace(/\b([A-Z][A-Za-z0-9_]*)\b/g, (m) => {
    if (BUILTINS.test(m)) {
      return m;
    }

    return MODEL_NAMES.has(m) && !local.declared.has(m)
      ? m
      : `${family}Types.${m}`;
  });
}

function indentBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}

function familyFile(
  family: string,
  doc: string,
  body: string[],
  decls: Emitter,
): string {
  return `${HEADER}import kotlinx.serialization.serializer
import dev.houwert.argus.kit.protocol.EmptyParams
import dev.houwert.argus.kit.protocol.IgnoredResult
import dev.houwert.argus.kit.protocol.RemoteCommand

/** Params and result types for \`${family}\` that no model names. */
object ${family}Types {
${indentBlock(decls.output())}}

/** ${doc} */
object ${family} {
${body.join("\n\n")}
}
`;
}

function paramsType(type: string): string {
  return type.replace(/\?$/, "");
}

function commandsFile(): string {
  const emitter = new Emitter();
  const entries: string[] = [];
  const commands = protocol.COMMANDS as Record<string, protocol.CommandSpec>;
  for (const name of Object.keys(commands).sort()) {
    const spec = commands[name];
    const base = pascal(name);
    const own = new Emitter();
    const params = qualify(
      paramsType(rootType(own, spec.params, `${base}Params`)),
      "Commands",
      own,
    );
    const result = qualify(
      rootType(own, spec.result, `${base}Result`),
      "Commands",
      own,
    );
    emitter.append(own);
    entries.push(
      `  object ${base} : RemoteCommand<${params}, ${result}>(${ktString(name)}, ${ktString(spec.tier)}, serializer(), serializer())`,
    );
  }

  return familyFile(
    "Commands",
    "Every raw host command, for a client holding the admin tier.",
    entries,
    emitter,
  );
}

function methodsFile(): string {
  const emitter = new Emitter();
  const entries: string[] = [];
  const params = protocol.MethodParams as Record<string, z.ZodType>;
  const results = protocol.MethodResult as Record<string, z.ZodType>;
  for (const name of Object.keys(params).sort()) {
    const base = pascal(name);
    const own = new Emitter();
    const p = qualify(
      paramsType(rootType(own, params[name], `${base}Params`)),
      "Methods",
      own,
    );
    const r = results[name]
      ? qualify(rootType(own, results[name], `${base}Result`), "Methods", own)
      : "IgnoredResult";
    emitter.append(own);
    entries.push(
      `  object ${base} : RemoteCommand<${p}, ${r}>(${ktString(name)}, "control", serializer(), serializer())`,
    );
  }

  return familyFile(
    "Methods",
    "The typed remote methods (`REMOTE_METHODS`), monitor and control tier.",
    entries,
    emitter,
  );
}

function eventsFile(): string {
  const emitter = new Emitter();
  const entries: string[] = [];
  const events = protocol.EventPayloads as Record<string, z.ZodType>;
  for (const name of Object.keys(events).sort()) {
    const base = pascal(name);
    const own = new Emitter();
    const type = qualify(
      rootType(own, events[name], `${base}Payload`),
      "Events",
      own,
    );
    emitter.append(own);
    entries.push(
      `  /** \`${name}\` */\n  val ${base} = EventSpec<${type}>(${ktString(name)}, serializer())`,
    );
  }

  return familyFile(
    "Events",
    "Payloads of the events the gateway pushes, by event name.",
    entries,
    emitter,
  ).replace(
    "import dev.houwert.argus.kit.protocol.RemoteCommand\n",
    "import dev.houwert.argus.kit.protocol.EventSpec\nimport dev.houwert.argus.kit.protocol.RemoteCommand\n",
  );
}

export function kotlinFiles(): Record<string, string> {
  return {
    "WireModels.kt": modelsFile(),
    "WireCommands.kt": commandsFile(),
    "WireMethods.kt": methodsFile(),
    "WireEvents.kt": eventsFile(),
  };
}
