/**
 * Definition heuristics: the candidate lines ripgrep found in a file, matched
 * against its language's patterns (`symbolLanguages`) to pull out names.
 * Scoping is by indentation: a member is a line indented under a type.
 */

import type { CodeSymbolKind } from "@argus/remote-protocol";
import {
  type Scope,
  SYMBOL_LANGUAGES,
  type SymbolLanguage,
  type SymbolRule,
} from "./symbolLanguages";

export { SYMBOL_LANGUAGES, type SymbolLanguage } from "./symbolLanguages";

/** Names a pattern can catch that are never definitions: control flow, calls to keywords. */
const RESERVED = new Set([
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "catch",
  "return",
  "function",
  "new",
  "throw",
  "await",
  "yield",
  "try",
  "do",
  "guard",
  "let",
  "var",
  "func",
  "in",
  "of",
  "typeof",
  "delete",
  "void",
  "super",
  "this",
  "self",
  "constructor",
  "class",
  "struct",
  "enum",
  "protocol",
  "extension",
  "interface",
  "import",
  "synchronized",
  "sizeof",
  "when",
  "where",
  "fn",
  "match",
  "loop",
]);

const BY_EXTENSION = new Map(
  SYMBOL_LANGUAGES.flatMap((l) => l.extensions.map((e) => [e, l] as const)),
);

export function languageForPath(relativePath: string): SymbolLanguage | null {
  const dot = relativePath.lastIndexOf(".");
  if (dot < 0 || dot < relativePath.lastIndexOf("/")) {
    return null;
  }

  return BY_EXTENSION.get(relativePath.slice(dot + 1).toLowerCase()) ?? null;
}

/** Every pattern, for ripgrep's prefilter. */
export function prefilterPatterns(): string[] {
  return [
    ...new Set(
      SYMBOL_LANGUAGES.flatMap((l) => l.rules.map((r) => r.re.source)),
    ),
  ];
}

export function indexedExtensions(): string[] {
  return SYMBOL_LANGUAGES.flatMap((l) => l.extensions);
}

/** A symbol before it's tied to a file. */
export interface RawSymbol {
  name: string;
  kind: CodeSymbolKind;
  container?: string;
  line: number;
  column: number;
}

interface Frame {
  indent: number;
  name: string;
  kind: CodeSymbolKind;
  scope: Scope;
}

function indentOf(text: string): number {
  let i = 0;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) {
    i++;
  }

  return i;
}

function allowed(rule: SymbolRule, parent: Frame | undefined): boolean {
  const inType = parent?.scope === "type";
  switch (rule.where) {
    case "top":
      return !parent;
    case "type":
      return inType;
    case "top_or_type":
      return !parent || inType;
    case "enum":
      return parent?.kind === "enum";
    default:
      return true;
  }
}

/** `case a, b(Int), c = 3` → each name with its column. */
function listed(
  text: string,
  from: number,
): { name: string; column: number }[] {
  const out: { name: string; column: number }[] = [];
  let depth = 0;
  let expecting = true;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      break;
    }
    if (c === "(" || c === "[" || c === "<") {
      depth++;
    } else if (c === ")" || c === "]" || c === ">") {
      depth--;
    } else if (c === "," && depth === 0) {
      expecting = true;
    } else if (expecting && depth === 0 && /[A-Za-z_`]/.test(c)) {
      const m = /^`?([A-Za-z_]\w*)/.exec(text.slice(i));
      if (m) {
        out.push({ name: m[1], column: i + (m[0].startsWith("`") ? 1 : 0) });
        i += m[0].length - 1;
      }
      expecting = false;
    }
  }

  return out;
}

/** One file's candidate lines (1-based, in order) → its definitions. */
export function extractSymbols(
  language: SymbolLanguage,
  lines: { line: number; text: string }[],
): RawSymbol[] {
  const out: RawSymbol[] = [];
  const stack: Frame[] = [];
  const byIndent = language.indentScopes !== false;
  for (const { line, text } of lines) {
    const indent = indentOf(text);
    if (byIndent) {
      while (stack.length && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
    }
    const parent = stack[stack.length - 1];
    for (const rule of language.rules) {
      const m = rule.re.exec(text);
      const group = rule.nameGroup ?? 1;
      const name = m?.[group];
      if (!m || !name || RESERVED.has(name) || !allowed(rule, parent)) {
        continue;
      }
      // Without indentation, a new container ends the last rather than nesting in it.
      const inType = parent?.scope === "type" && (byIndent || !rule.opens);
      const kind = inType && rule.member ? rule.member : rule.kind;
      const container =
        (rule.containerGroup ? m[rule.containerGroup] : undefined) ??
        (inType ? parent.name : undefined);
      if (!rule.containerOnly) {
        const start = m.indices?.[group]?.[0] ?? 0;
        const names = rule.list
          ? listed(text, start)
          : [{ name, column: start }];
        for (const entry of names) {
          if (!RESERVED.has(entry.name)) {
            out.push({
              ...entry,
              kind,
              line,
              ...(container ? { container } : {}),
            });
          }
        }
      }
      if (rule.opens) {
        if (!byIndent) {
          stack.length = 0;
        }
        stack.push({ indent, name, kind, scope: rule.opens });
      }
      break;
    }
  }

  return out;
}
