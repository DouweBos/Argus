/**
 * Generates ArgusKit's Swift wire types from the zod catalog in
 * `@argus/remote-protocol`: every raw command (`COMMANDS`), every typed remote
 * method (`MethodParams` / `MethodResult`) and every event payload.
 *
 *   pnpm gen:protocol          write the Swift files
 *   pnpm gen:protocol --check  fail if they are out of date (run by lint)
 *
 * Each zod schema goes through `z.toJSONSchema`, then a small emitter turns the
 * JSON Schema into Codable Swift. Exported schemas keep their export name;
 * anonymous nested objects are named after where they sit.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { error, info } from "@argus/host/logger";
import * as protocol from "@argus/remote-protocol";

const OUT_DIR = path.resolve(
  import.meta.dirname,
  "../clients/apple/ArgusKit/Sources/ArgusKit/Generated",
);
const NAMESPACE = "ArgusProtocol";

interface JsonSchema {
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

// --- Named schemas ---------------------------------------------------------

const registry = z.registry<{ id: string }>();
const nameOf = new Map<z.ZodType, string>();

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

function toJson(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, {
    metadata: registry,
    unrepresentable: "any",
    io: "output",
    target: "draft-2020-12",
  }) as JsonSchema;
}

function isVoid(schema: z.ZodType): boolean {
  return (schema as unknown as { def: { type: string } }).def.type === "void";
}

// --- Swift emission --------------------------------------------------------

const SWIFT_KEYWORDS = new Set([
  "associatedtype",
  "break",
  "case",
  "catch",
  "class",
  "continue",
  "default",
  "defer",
  "deinit",
  "do",
  "else",
  "enum",
  "extension",
  "fallthrough",
  "false",
  "fileprivate",
  "for",
  "func",
  "guard",
  "if",
  "import",
  "in",
  "init",
  "inout",
  "internal",
  "is",
  "let",
  "nil",
  "open",
  "operator",
  "private",
  "protocol",
  "public",
  "repeat",
  "rethrows",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "subscript",
  "super",
  "switch",
  "throw",
  "throws",
  "true",
  "try",
  "Type",
  "typealias",
  "var",
  "where",
  "while",
]);

function words(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function pascal(raw: string): string {
  const out = words(raw)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");

  return /^[0-9]/.test(out) ? `_${out}` : out || "Value";
}

function camel(raw: string): string {
  const p = pascal(raw);
  const out = p[0].toLowerCase() + p.slice(1);

  return SWIFT_KEYWORDS.has(out) ? `\`${out}\`` : out;
}

function swiftString(value: string): string {
  return JSON.stringify(value);
}

function docComment(text: string | undefined, indent: string): string {
  if (!text) {
    return "";
  }

  return (
    text
      .split("\n")
      .map((line) => `${indent}/// ${line}`.trimEnd())
      .join("\n") + "\n"
  );
}

class Emitter {
  private readonly decls: string[] = [];
  private readonly emitted = new Set<string>();
  /** Every type declared here or in an adopted emitter. */
  readonly declared = new Set<string>();

  constructor(
    private readonly defs: Record<string, JsonSchema> = {},
    /** What a self-reference (`$ref: "#"`) in a recursive schema names. */
    private readonly root = "JSONValue",
  ) {}

  output(): string {
    return this.decls.join("\n");
  }

  /** Adopt the declarations a scoped emitter produced. */
  append(other: Emitter): void {
    const out = other.output();
    if (out) {
      this.decls.push(out);
    }
    for (const name of [...other.emitted, ...other.declared]) {
      this.declared.add(name);
    }
  }

  /** The Swift type for a schema, declaring nested types as needed. */
  typeFor(schema: JsonSchema, context: string): string {
    if (schema.$ref) {
      return this.refName(schema.$ref);
    }
    const nullable = this.stripNull(schema);
    if (nullable) {
      return `${this.typeFor(nullable, context)}?`;
    }
    if (schema.enum && schema.enum.every((v) => typeof v === "string")) {
      return this.declareEnum(context, schema.enum as string[], schema);
    }
    if (schema.const !== undefined) {
      return swiftScalar(typeof schema.const);
    }
    const union = schema.oneOf ?? schema.anyOf;
    if (union) {
      return this.declareUnion(context, union, schema);
    }
    switch (schema.type) {
      case "string":
        return "String";
      case "integer":
        return "Int";
      case "number":
        return "Double";
      case "boolean":
        return "Bool";
      case "null":
        return "JSONValue";
      case "array":
        if (schema.prefixItems) {
          return "[JSONValue]";
        }

        return `[${schema.items ? this.typeFor(schema.items, `${context}Item`) : "JSONValue"}]`;
      case "object": {
        const extra = schema.additionalProperties;
        if (!schema.properties && extra && typeof extra === "object") {
          return `[String: ${this.typeFor(extra, `${context}Value`)}]`;
        }
        if (!schema.properties) {
          return "[String: JSONValue]";
        }

        return this.declareStruct(context, schema);
      }
      default:
        return "JSONValue";
    }
  }

  /** Declare a named top-level type (a model, params or result). */
  declareNamed(name: string, schema: JsonSchema): string {
    const type = this.typeFor(schema, name);
    if (type !== name && !this.emitted.has(name)) {
      this.emitted.add(name);
      this.decls.push(
        `${docComment(schema.description, "  ")}  public typealias ${name} = ${type}\n`,
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

  private stripNull(schema: JsonSchema): JsonSchema | null {
    // zod writes a nullable scalar as `type: ["string", "null"]`.
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

  private declareStruct(name: string, schema: JsonSchema): string {
    if (this.emitted.has(name)) {
      return name;
    }
    this.emitted.add(name);
    const required = new Set(schema.required ?? []);
    const used = new Set<string>();
    const fields = Object.entries(schema.properties ?? {}).map(
      ([key, prop]) => {
        let swiftName = camel(key);
        while (used.has(swiftName)) {
          swiftName = `${swiftName}_`;
        }
        used.add(swiftName);
        const optional = !required.has(key) || prop.default !== undefined;
        let type = this.typeFor(prop, `${name}${pascal(key)}`);
        const nullable = type.endsWith("?");
        if (optional && !nullable) {
          type = `${type}?`;
        }

        return {
          key,
          swiftName,
          type,
          optional,
          nullable,
          doc: prop.description,
        };
      },
    );

    const lines: string[] = [];
    lines.push(docComment(schema.description, "  ").trimEnd());
    lines.push(`  public struct ${name}: Codable, Sendable {`);
    for (const f of fields) {
      const doc = docComment(f.doc, "    ");
      lines.push(`${doc}    public var ${f.swiftName}: ${f.type}`);
    }
    if (fields.length > 0) {
      lines.push("");
      lines.push("    enum CodingKeys: String, CodingKey {");
      for (const f of fields) {
        lines.push(`      case ${f.swiftName} = ${swiftString(f.key)}`);
      }
      lines.push("    }");
    }
    lines.push("");
    const local = (f: { swiftName: string }) =>
      f.swiftName.startsWith("`")
        ? `${f.swiftName.replace(/`/g, "")}_`
        : f.swiftName;
    const args = fields.map((f) => {
      const label = f.swiftName.replace(/`/g, "");
      const binding = local(f) === label ? label : `${label} ${local(f)}`;

      return `${binding}: ${f.type}${f.type.endsWith("?") ? " = nil" : ""}`;
    });
    lines.push(`    public init(${args.join(", ")}) {`);
    for (const f of fields) {
      lines.push(`      self.${f.swiftName} = ${local(f)}`);
    }
    lines.push("    }");
    lines.push("");
    lines.push("    public func encode(to encoder: Encoder) throws {");
    if (fields.length === 0) {
      lines.push("      _ = encoder.container(keyedBy: AnyCodingKey.self)");
    } else {
      lines.push("      var c = encoder.container(keyedBy: CodingKeys.self)");
      for (const f of fields) {
        // Nil in a required-but-nullable field must still go out as `null`.
        const sendNull = f.nullable && !f.optional;
        const call =
          f.type.endsWith("?") && !sendNull ? "encodeIfPresent" : "encode";
        lines.push(
          `      try c.${call}(${f.swiftName}, forKey: .${f.swiftName.replace(/`/g, "")})`,
        );
      }
    }
    lines.push("    }");
    lines.push("  }");
    this.decls.push(
      lines.filter((l, i) => i > 0 || l !== "").join("\n") + "\n",
    );

    return name;
  }

  /**
   * String enums decode unknown values instead of failing, so a newer host
   * adding a case never breaks an older client.
   */
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
      let c = camel(v);
      while (used.has(c)) {
        c = `${c}_`;
      }
      used.add(c);

      return `    public static let ${c} = ${name}(rawValue: ${swiftString(v)})`;
    });
    this.decls.push(
      `${docComment(schema.description, "  ")}  public struct ${name}: RawRepresentable, Codable, Hashable, Sendable {
    public var rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(from decoder: Decoder) throws {
      rawValue = try decoder.singleValueContainer().decode(String.self)
    }
    public func encode(to encoder: Encoder) throws {
      var c = encoder.singleValueContainer()
      try c.encode(rawValue)
    }

${cases.join("\n")}
  }
`,
    );

    return name;
  }

  /**
   * A union of objects sharing a `const` discriminator becomes an enum with an
   * `unknown` fallback; any other union is carried as raw JSON.
   */
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

      return "JSONValue";
    }
    if (this.emitted.has(name)) {
      return name;
    }
    this.emitted.add(name);
    const cases = members.map((m) => {
      const resolved = m.$ref
        ? this.defs[m.$ref.replace(/^#\/\$defs\//, "")]
        : m;
      const tag = String(resolved?.properties?.[discriminator]?.const);
      const payload = this.typeFor(m, `${name}${pascal(tag)}`);

      return { tag, caseName: camel(tag), payload };
    });
    const lines = [
      `${docComment(schema.description, "  ")}  public enum ${name}: Codable, Sendable {`,
      ...cases.map((c) => `    case ${c.caseName}(${c.payload})`),
      "    case unknown(JSONValue)",
      "",
      "    private enum Tag: String, CodingKey { case tag = " +
        swiftString(discriminator) +
        " }",
      "",
      "    public init(from decoder: Decoder) throws {",
      "      let tag = try decoder.container(keyedBy: Tag.self).decodeIfPresent(String.self, forKey: .tag)",
      "      switch tag {",
      ...cases.map(
        (c) =>
          `      case ${swiftString(c.tag)}: self = .${c.caseName}(try ${c.payload}(from: decoder))`,
      ),
      "      default: self = .unknown(try JSONValue(from: decoder))",
      "      }",
      "    }",
      "",
      "    public func encode(to encoder: Encoder) throws {",
      "      switch self {",
      ...cases.map(
        (c) =>
          `      case .${c.caseName}(let value): try value.encode(to: encoder)`,
      ),
      "      case .unknown(let value): try value.encode(to: encoder)",
      "      }",
      "    }",
      "  }",
      "",
    ];
    this.decls.push(lines.join("\n"));

    return name;
  }
}

function swiftScalar(kind: string): string {
  switch (kind) {
    case "number":
      return "Double";
    case "boolean":
      return "Bool";
    default:
      return "String";
  }
}

function findDiscriminator(members: JsonSchema[]): string | null {
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

// --- Files -----------------------------------------------------------------

const MODEL_NAMES = new Set(nameOf.values());

const HEADER = `// Generated by scripts/gen-protocol.ts from @argus/remote-protocol.
// Do not edit — run \`pnpm gen:protocol\`.

import Foundation
`;

/** A root schema: a named model is referenced, anything else is declared. */
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

function defsOf(json: JsonSchema): Record<string, JsonSchema> {
  return (json as { $defs?: Record<string, JsonSchema> }).$defs ?? {};
}

function modelsFile(): string {
  const emitter = new Emitter();
  for (const [schema, name] of [...nameOf].sort(([, a], [, b]) =>
    a.localeCompare(b),
  )) {
    const json = toJson(schema);
    const defs = defsOf(json);
    // A registered schema comes back as a `$ref` to its own `$defs` entry.
    const body = json.$ref === `#/$defs/${name}` ? defs[name] : json;
    const scoped = new Emitter(defs, name);
    scoped.declareNamed(name, body);
    emitter.append(scoped);
  }

  return `${HEADER}
extension ${NAMESPACE} {
${emitter.output()}}
`;
}

/**
 * Inline params/result types live in their own enum per family, so a raw
 * command and a typed method that pascal-case alike (`claude_accounts_add`,
 * `claude_accounts.add`) never collide, and a command enum never shadows a
 * model of the same name (`git_commit` vs `GitCommit`).
 */
function familyFile(
  family: string,
  doc: string,
  body: string[],
  decls: Emitter,
): string {
  return `${HEADER}
extension ${NAMESPACE} {
  /// Params and result types for \`${family}\` that no model names.
  public enum ${family}Types {
${indentLines(decls.output())}  }

  /// ${doc}
  public enum ${family} {
${body.join("\n\n")}
  }
}
`;
}

function indentLines(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}

const BUILTINS =
  /^(String|Int|Double|Bool|JSONValue|IgnoredResult|EmptyParams)$/;

/**
 * Resolve a type named inside a family to a fully qualified Swift type. One the
 * family declared itself wins over a model of the same name: `huddle_say`'s own
 * `HuddleSayParams` is not the gateway method's.
 */
function qualify(type: string, family: string, local: Emitter): string {
  return type.replace(/\b([A-Z][A-Za-z0-9_]*)\b/g, (m) => {
    if (BUILTINS.test(m)) {
      return m;
    }

    return MODEL_NAMES.has(m) && !local.declared.has(m)
      ? `${NAMESPACE}.${m}`
      : `${NAMESPACE}.${family}Types.${m}`;
  });
}

function commandsFile(): string {
  const emitter = new Emitter();
  const entries: string[] = [];
  const commands = protocol.COMMANDS as Record<string, protocol.CommandSpec>;
  for (const name of Object.keys(commands).sort()) {
    const spec = commands[name];
    const base = pascal(name);
    const own = new Emitter();
    const params = rootType(own, spec.params, `${base}Params`);
    const result = rootType(own, spec.result, `${base}Result`);
    emitter.append(own);
    entries.push(`    public enum ${base}: RemoteCommand {
      public typealias Params = ${qualify(stripOptional(params), "Commands", own)}
      public typealias Result = ${qualify(result, "Commands", own)}
      public static let name = ${swiftString(name)}
      public static let tier = ${swiftString(spec.tier)}
    }`);
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
    const p = rootType(own, params[name], `${base}Params`);
    const r = results[name]
      ? rootType(own, results[name], `${base}Result`)
      : "IgnoredResult";
    emitter.append(own);
    entries.push(`    public enum ${base}: RemoteCommand {
      public typealias Params = ${qualify(stripOptional(p), "Methods", own)}
      public typealias Result = ${qualify(r, "Methods", own)}
      public static let name = ${swiftString(name)}
    }`);
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
    const type = rootType(own, events[name], `${base}Payload`);
    emitter.append(own);
    entries.push(
      `    /// \`${name}\`\n    public typealias ${base} = ${qualify(type, "Events", own)}`,
    );
  }

  return familyFile(
    "Events",
    "Payloads of the events the gateway pushes, by event name.",
    entries,
    emitter,
  );
}

/** Params must be a concrete struct; primitives and optionals are wrapped. */
function stripOptional(type: string): string {
  return type.replace(/\?$/, "");
}

function namespaceFile(): string {
  return `${HEADER}
/// Wire types generated from the host's zod catalog. Hand-written models in
/// \`Protocol/\` predate it and migrate here over time.
public enum ${NAMESPACE} {}

/// Keys for a struct with no fields, which still encodes as \`{}\`.
struct AnyCodingKey: CodingKey {
  var stringValue: String
  var intValue: Int?
  init?(stringValue: String) { self.stringValue = stringValue }
  init?(intValue: Int) {
    self.stringValue = String(intValue)
    self.intValue = intValue
  }
}
`;
}

// --- Main ------------------------------------------------------------------

const files: Record<string, string> = {
  "ArgusProtocol.swift": namespaceFile(),
  "WireModels.swift": modelsFile(),
  "WireCommands.swift": commandsFile(),
  "WireMethods.swift": methodsFile(),
  "WireEvents.swift": eventsFile(),
};

const check = process.argv.includes("--check");
const stale: string[] = [];
if (!check) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}
for (const [file, content] of Object.entries(files)) {
  const target = path.join(OUT_DIR, file);
  const current = fs.existsSync(target)
    ? fs.readFileSync(target, "utf-8")
    : null;
  if (current === content) {
    continue;
  }
  if (check) {
    stale.push(file);
  } else {
    fs.writeFileSync(target, content);
    info(`[gen-protocol] wrote ${path.relative(process.cwd(), target)}`);
  }
}
if (check && stale.length > 0) {
  error(
    `[gen-protocol] out of date: ${stale.join(", ")} — run \`pnpm gen:protocol\``,
  );
  process.exit(1);
}
