/**
 * The definition patterns per language, one regex per kind of declaration.
 * ripgrep runs them all as a prefilter, so every pattern must also be valid
 * Rust regex: no lookaround, no backreferences.
 */

import type { CodeSymbolKind } from "@argus/remote-protocol";

export type Scope = "function" | "type";

export interface SymbolRule {
  kind: CodeSymbolKind;
  /** Group 1 is the name, unless `nameGroup` says otherwise. */
  re: RegExp;
  nameGroup?: number;
  /** A group naming the container outright, e.g. a Go method's receiver. */
  containerGroup?: number;
  /** Where the line counts: at the top level, directly in a type, either, or in an enum. */
  where?: "enum" | "top_or_type" | "top" | "type";
  /** The kind when directly inside a type: `func` → method. */
  member?: CodeSymbolKind;
  /** Lines indented under this one are inside it. */
  opens?: Scope;
  /** A scope only, never listed itself (Rust `impl`, ObjC `@implementation`). */
  containerOnly?: boolean;
  /** `case a, b, c`: every name on the line. */
  list?: boolean;
}

export interface SymbolLanguage {
  name: string;
  extensions: string[];
  rules: SymbolRule[];
  /** False: a container lasts until the next one (ObjC's `@end` is never seen). */
  indentScopes?: boolean;
}

const re = (source: string) => new RegExp(source, "d");

const SWIFT_MODS = String.raw`(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|package|final|static|class|override|mutating|nonmutating|indirect|lazy|weak|unowned|nonisolated|dynamic|required|convenience|distributed|optional|prefix|postfix|infix)(?:\([^)]*\))?\s+)*`;
const SWIFT_ID = String.raw`\x60?([A-Za-z_]\w*)\x60?`;
const swift = (keyword: string, id = SWIFT_ID) =>
  re(String.raw`^\s*${SWIFT_MODS}${keyword}\s+${id}`);

const TS_ID = String.raw`([A-Za-z_$][\w$]*)`;
const TS_EXPORT = String.raw`^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?`;
const TS_MEMBER_MODS = String.raw`(?:(?:public|private|protected|static|async|override|abstract|readonly|get|set)\s+)*`;

const KOTLIN_MODS = String.raw`^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|open|abstract|final|sealed|data|enum|annotation|inner|override|suspend|inline|operator|infix|tailrec|external|const|lateinit|value|expect|actual|companion)\s+)*`;

const JAVA_MODS = String.raw`^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|static|final|abstract|sealed|non-sealed|strictfp|synchronized|native|default|transient|volatile)\s+)*`;
const JAVA_TYPE = String.raw`[\w.]+(?:<[\w<>,.?\s\[\]]*>)?(?:\[\])*`;

const RUST_VIS = String.raw`^\s*(?:pub(?:\([^)]*\))?\s+)?`;

export const SYMBOL_LANGUAGES: SymbolLanguage[] = [
  {
    name: "swift",
    extensions: ["swift"],
    rules: [
      { kind: "class", re: swift("class"), opens: "type" },
      { kind: "class", re: swift("actor"), opens: "type" },
      { kind: "struct", re: swift("struct"), opens: "type" },
      { kind: "enum", re: swift("enum"), opens: "type" },
      { kind: "protocol", re: swift("protocol"), opens: "type" },
      {
        kind: "extension",
        re: swift("extension", String.raw`([A-Za-z_][\w.]*)`),
        opens: "type",
      },
      { kind: "type_alias", re: swift("typealias") },
      {
        kind: "function",
        member: "method",
        re: swift("func"),
        opens: "function",
      },
      {
        kind: "variable",
        member: "property",
        re: swift("var"),
        where: "top_or_type",
        opens: "function",
      },
      {
        kind: "constant",
        member: "property",
        re: swift("let"),
        where: "top_or_type",
        opens: "function",
      },
      { kind: "enum_member", re: swift("case"), where: "enum", list: true },
    ],
  },
  {
    name: "typescript",
    extensions: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
    rules: [
      {
        kind: "class",
        re: re(String.raw`${TS_EXPORT}(?:abstract\s+)?class\s+${TS_ID}`),
        opens: "type",
      },
      {
        kind: "interface",
        re: re(String.raw`${TS_EXPORT}interface\s+${TS_ID}`),
        opens: "type",
      },
      {
        kind: "enum",
        re: re(String.raw`${TS_EXPORT}(?:const\s+)?enum\s+${TS_ID}`),
        opens: "type",
      },
      {
        kind: "type_alias",
        re: re(String.raw`${TS_EXPORT}type\s+${TS_ID}\s*[=<]`),
      },
      {
        kind: "module",
        re: re(
          String.raw`${TS_EXPORT}(?:namespace|module)\s+([A-Za-z_$][\w$.]*)\s*\{`,
        ),
        opens: "type",
      },
      {
        kind: "function",
        re: re(String.raw`${TS_EXPORT}(?:async\s+)?function\s*\*?\s*${TS_ID}`),
        opens: "function",
      },
      {
        kind: "function",
        re: re(
          String.raw`^(?:export\s+)?(?:const|let|var)\s+${TS_ID}\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)`,
        ),
        where: "top",
        opens: "function",
      },
      {
        kind: "constant",
        re: re(String.raw`^(?:export\s+)?(?:declare\s+)?const\s+${TS_ID}`),
        where: "top",
        opens: "function",
      },
      {
        kind: "variable",
        re: re(
          String.raw`^(?:export\s+)?(?:declare\s+)?(?:let|var)\s+${TS_ID}`,
        ),
        where: "top",
        opens: "function",
      },
      {
        kind: "method",
        re: re(
          String.raw`^\s+${TS_MEMBER_MODS}\*?(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^;{=]+)?\{\s*$`,
        ),
        where: "type",
        opens: "function",
      },
      {
        kind: "property",
        re: re(
          String.raw`^\s+(?:(?:public|private|protected|static|readonly|declare|override|abstract|accessor)\s+)+(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*[:=;]`,
        ),
        where: "type",
      },
      {
        kind: "property",
        re: re(String.raw`^\s+(#[A-Za-z_$][\w$]*)\s*[:=;]`),
        where: "type",
      },
    ],
  },
  {
    name: "python",
    extensions: ["py", "pyi"],
    rules: [
      { kind: "class", re: re(String.raw`^\s*class\s+(\w+)`), opens: "type" },
      {
        kind: "function",
        member: "method",
        re: re(String.raw`^\s*(?:async\s+)?def\s+(\w+)`),
        opens: "function",
      },
      {
        kind: "constant",
        re: re(String.raw`^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=[^=]`),
        where: "top",
      },
    ],
  },
  {
    name: "ruby",
    extensions: ["rb", "rake"],
    rules: [
      {
        kind: "class",
        re: re(String.raw`^\s*class\s+([A-Z][\w:]*)`),
        opens: "type",
      },
      {
        kind: "module",
        re: re(String.raw`^\s*module\s+([A-Z][\w:]*)`),
        opens: "type",
      },
      {
        kind: "function",
        member: "method",
        re: re(String.raw`^\s*def\s+(?:self\.)?(\w+[?!=]?)`),
        opens: "function",
      },
      {
        kind: "constant",
        re: re(String.raw`^\s*([A-Z][A-Z0-9_]+)\s*=[^=]`),
        where: "top_or_type",
      },
    ],
  },
  {
    name: "go",
    extensions: ["go"],
    rules: [
      {
        kind: "method",
        re: re(String.raw`^func\s+\(\s*\w*\s+\*?\s*(\w+)[^)]*\)\s*(\w+)`),
        nameGroup: 2,
        containerGroup: 1,
      },
      { kind: "function", re: re(String.raw`^func\s+(\w+)`) },
      {
        kind: "struct",
        re: re(String.raw`^type\s+(\w+)(?:\[[^\]]*\])?\s+struct\b`),
      },
      {
        kind: "interface",
        re: re(String.raw`^type\s+(\w+)(?:\[[^\]]*\])?\s+interface\b`),
      },
      { kind: "type_alias", re: re(String.raw`^type\s+(\w+)`) },
      { kind: "constant", re: re(String.raw`^const\s+(\w+)`) },
      { kind: "variable", re: re(String.raw`^var\s+(\w+)`) },
    ],
  },
  {
    name: "rust",
    extensions: ["rs"],
    rules: [
      {
        kind: "function",
        member: "method",
        re: re(
          String.raw`${RUST_VIS}(?:(?:async|const|unsafe|default|extern(?:\s+"[^"]*")?)\s+)*fn\s+(\w+)`,
        ),
        opens: "function",
      },
      {
        kind: "struct",
        re: re(String.raw`${RUST_VIS}struct\s+(\w+)`),
        opens: "type",
      },
      {
        kind: "enum",
        re: re(String.raw`${RUST_VIS}enum\s+(\w+)`),
        opens: "type",
      },
      {
        kind: "interface",
        re: re(String.raw`${RUST_VIS}(?:unsafe\s+)?trait\s+(\w+)`),
        opens: "type",
      },
      {
        kind: "type_alias",
        re: re(String.raw`${RUST_VIS}type\s+(\w+)`),
        where: "top_or_type",
      },
      {
        kind: "module",
        re: re(String.raw`${RUST_VIS}mod\s+(\w+)\s*\{`),
        opens: "type",
      },
      {
        kind: "constant",
        re: re(String.raw`${RUST_VIS}(?:const|static)\s+(?:mut\s+)?(\w+)\s*:`),
        where: "top_or_type",
      },
      {
        kind: "extension",
        re: re(
          String.raw`^\s*(?:unsafe\s+)?impl(?:<[^>]*>)?\s+(?:[\w:]+(?:<[^>]*>)?\s+for\s+)?(\w+)`,
        ),
        opens: "type",
        containerOnly: true,
      },
    ],
  },
  {
    name: "kotlin",
    extensions: ["kt", "kts"],
    rules: [
      {
        kind: "enum",
        re: re(String.raw`${KOTLIN_MODS}enum\s+class\s+(\w+)`),
        opens: "type",
      },
      {
        kind: "interface",
        re: re(String.raw`${KOTLIN_MODS}(?:fun\s+)?interface\s+(\w+)`),
        opens: "type",
      },
      {
        kind: "class",
        re: re(String.raw`${KOTLIN_MODS}(?:class|object)\s+(\w+)`),
        opens: "type",
      },
      {
        kind: "type_alias",
        re: re(String.raw`${KOTLIN_MODS}typealias\s+(\w+)`),
      },
      {
        kind: "function",
        member: "method",
        re: re(
          String.raw`${KOTLIN_MODS}fun\s+(?:<[^>]*>\s*)?(?:[\w.]+(?:<[^>]*>)?\.)?(\w+)\s*\(`,
        ),
        opens: "function",
      },
      {
        kind: "constant",
        member: "property",
        re: re(String.raw`${KOTLIN_MODS}val\s+(\w+)`),
        where: "top_or_type",
        opens: "function",
      },
      {
        kind: "variable",
        member: "property",
        re: re(String.raw`${KOTLIN_MODS}var\s+(\w+)`),
        where: "top_or_type",
        opens: "function",
      },
    ],
  },
  {
    name: "java",
    extensions: ["java"],
    rules: [
      {
        kind: "interface",
        re: re(String.raw`${JAVA_MODS}@?interface\s+(\w+)`),
        opens: "type",
      },
      {
        kind: "enum",
        re: re(String.raw`${JAVA_MODS}enum\s+(\w+)`),
        opens: "type",
      },
      {
        kind: "class",
        re: re(String.raw`${JAVA_MODS}(?:class|record)\s+(\w+)`),
        opens: "type",
      },
      {
        kind: "method",
        re: re(
          String.raw`${JAVA_MODS}(?:<[^>]*>\s+)?(?:${JAVA_TYPE}\s+)?(\w+)\s*\([^;]*\)\s*(?:throws\s+[\w.,\s]+)?(?:\{|;)?\s*$`,
        ),
        where: "type",
        opens: "function",
      },
      {
        kind: "property",
        re: re(String.raw`${JAVA_MODS}${JAVA_TYPE}\s+(\w+)\s*(?:=|;)`),
        where: "type",
      },
    ],
  },
  {
    name: "objc",
    extensions: ["m", "mm", "h"],
    indentScopes: false,
    rules: [
      {
        kind: "extension",
        re: re(String.raw`^@interface\s+(\w+)\s*\(`),
        opens: "type",
      },
      { kind: "class", re: re(String.raw`^@interface\s+(\w+)`), opens: "type" },
      {
        kind: "class",
        re: re(String.raw`^@implementation\s+(\w+)`),
        opens: "type",
        containerOnly: true,
      },
      {
        kind: "protocol",
        re: re(String.raw`^@protocol\s+(\w+)\s*(?:<[^>]*>)?\s*$`),
        opens: "type",
      },
      {
        kind: "method",
        re: re(String.raw`^[-+]\s*\([^)]*\)\s*(\w+)`),
        where: "type",
      },
      {
        kind: "property",
        re: re(String.raw`^@property\s*(?:\([^)]*\))?[^;]*?\b(\w+)\s*;`),
        where: "type",
      },
    ],
  },
];
