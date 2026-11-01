/**
 * Which grammar highlights a file: by name, then extension, then a shebang.
 * The ids are highlight.js's, the set Peacock's `CodeViewer` bundles; anything
 * else reads as plain text.
 */

export type CodeLanguage =
  | "bash"
  | "c"
  | "cpp"
  | "csharp"
  | "css"
  | "dart"
  | "diff"
  | "dockerfile"
  | "go"
  | "graphql"
  | "groovy"
  | "ini"
  | "java"
  | "javascript"
  | "json"
  | "kotlin"
  | "less"
  | "lua"
  | "makefile"
  | "markdown"
  | "objectivec"
  | "perl"
  | "php"
  | "python"
  | "r"
  | "ruby"
  | "rust"
  | "scss"
  | "sql"
  | "swift"
  | "typescript"
  | "xml"
  | "yaml";

export const CODE_LANGUAGE_NAMES: Record<CodeLanguage, string> = {
  bash: "Shell",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  dart: "Dart",
  diff: "Diff",
  dockerfile: "Dockerfile",
  go: "Go",
  graphql: "GraphQL",
  groovy: "Groovy",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  less: "Less",
  lua: "Lua",
  makefile: "Makefile",
  markdown: "Markdown",
  objectivec: "Objective-C",
  perl: "Perl",
  php: "PHP",
  python: "Python",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  scss: "SCSS",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

const BY_NAME: Record<string, CodeLanguage> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  gemfile: "ruby",
  podfile: "ruby",
  fastfile: "ruby",
  rakefile: "ruby",
  brewfile: "ruby",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".profile": "bash",
  ".env": "ini",
  ".gitconfig": "ini",
  ".editorconfig": "ini",
  ".npmrc": "ini",
};

const BY_EXTENSION: Record<string, CodeLanguage> = {
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  diff: "diff",
  patch: "diff",
  go: "go",
  graphql: "graphql",
  gql: "graphql",
  gradle: "groovy",
  groovy: "groovy",
  ini: "ini",
  toml: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "ini",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  mk: "makefile",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  m: "objectivec",
  mm: "objectivec",
  pl: "perl",
  pm: "perl",
  php: "php",
  py: "python",
  pyi: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sass: "scss",
  sql: "sql",
  swift: "swift",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  plist: "xml",
  storyboard: "xml",
  xib: "xml",
  vue: "xml",
  yml: "yaml",
  yaml: "yaml",
};

const SHEBANG: [RegExp, CodeLanguage][] = [
  [/\b(?:ba|z|k)?sh\b/, "bash"],
  [/\bnode\b|\bdeno\b|\bbun\b/, "javascript"],
  [/\bpython[\d.]*\b/, "python"],
  [/\bruby\b/, "ruby"],
  [/\bperl\b/, "perl"],
  [/\bphp\b/, "php"],
];

export function detectCodeLanguage(
  path: string,
  firstLine?: string,
): CodeLanguage | null {
  const name = (path.split("/").at(-1) ?? path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) {
    return byName;
  }
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const byExtension = BY_EXTENSION[name.slice(dot + 1)];
    if (byExtension) {
      return byExtension;
    }
  }
  if (firstLine?.startsWith("#!")) {
    return SHEBANG.find(([pattern]) => pattern.test(firstLine))?.[1] ?? null;
  }

  return null;
}
