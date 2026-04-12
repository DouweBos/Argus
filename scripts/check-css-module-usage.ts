/**
 * Project-wide CSS module checks (complements ESLint css-modules-next rules):
 * - Reports classes defined in a *.module.css that are never referenced from
 *   any TS/TSX file that imports that module (handles shared CSS modules).
 *
 * Skips unused detection for a CSS file when any importer uses dynamic
 * bracket access (e.g. styles[`badge${status}`]) — those cannot be verified
 * statically without a full TS AST + dataflow.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import postcss from "postcss";
import { error } from "../app/lib/logger";

const APP_ROOT = resolve(import.meta.dirname, "../app");

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) {
      continue;
    }
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walkFiles(p, out);
    } else {
      out.push(p);
    }
  }

  return out;
}

function extractClassNames(cssPath: string): Set<string> | null {
  const ext = extname(cssPath).toLowerCase();
  if (ext !== ".css") {
    return null;
  }
  const content = readFileSync(cssPath, "utf8");
  let root;
  try {
    root = postcss.parse(content);
  } catch {
    return null;
  }
  const classNames = new Set<string>();
  root.walkRules((rule) => {
    const localSelector = rule.selector.replace(/:global\([^)]*\)/g, "");
    const matches = localSelector.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g);
    for (const match of matches) {
      classNames.add(match[1]);
    }
  });

  return classNames;
}

/** import localName from './path.module.css' or '../path.module.css' */
const MODULE_IMPORT_RE =
  /import\s+(\w+)\s+from\s+['"]((?:\.\/|\.\.\/)[^'"]+\.module\.(?:css|scss|less))['"]/g;

interface CssImportEdge {
  readonly tsPath: string;
  readonly cssAbs: string;
  readonly localName: string;
}

function collectCssImportEdges(tsFiles: string[]): CssImportEdge[] {
  const edges: CssImportEdge[] = [];
  for (const tsPath of tsFiles) {
    const text = readFileSync(tsPath, "utf8");
    let m: RegExpExecArray | null;
    MODULE_IMPORT_RE.lastIndex = 0;
    while ((m = MODULE_IMPORT_RE.exec(text)) !== null) {
      const localName = m[1];
      const importPath = m[2];
      const cssAbs = resolve(dirname(tsPath), importPath);
      edges.push({ tsPath, cssAbs, localName });
    }
  }

  return edges;
}

/** True if file uses styles[`...`] (template) — not statically enumerable. */
function hasDynamicStylesAccess(text: string): boolean {
  return /\b\w+\s*\[\s*`/.test(text);
}

function isClassUsedWithBinding(
  className: string,
  text: string,
  binding: string,
): boolean {
  const dot = new RegExp(
    `\\b${escapeRegExp(binding)}\\.${escapeRegExp(className)}\\b`,
  );
  if (dot.test(text)) {
    return true;
  }
  const brSingle = new RegExp(
    `\\b${escapeRegExp(binding)}\\[\\s*'${escapeRegExp(className)}'\\s*\\]`,
  );
  const brDouble = new RegExp(
    `\\b${escapeRegExp(binding)}\\[\\s*"${escapeRegExp(className)}"\\s*\\]`,
  );

  return brSingle.test(text) || brDouble.test(text);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main(): void {
  const tsFiles = walkFiles(APP_ROOT).filter((f) => {
    const e = extname(f);

    return e === ".ts" || e === ".tsx";
  });

  const edges = collectCssImportEdges(tsFiles);

  /** css absolute path -> edges into that file */
  const edgesByCss = new Map<string, CssImportEdge[]>();
  for (const edge of edges) {
    let list = edgesByCss.get(edge.cssAbs);
    if (!list) {
      list = [];
      edgesByCss.set(edge.cssAbs, list);
    }
    list.push(edge);
  }

  const errors: string[] = [];

  for (const [cssAbs, cssEdges] of edgesByCss) {
    const defined = extractClassNames(cssAbs);
    if (!defined || defined.size === 0) {
      continue;
    }

    const importerTexts = new Map(
      [...new Set(cssEdges.map((e) => e.tsPath))].map((p) => [
        p,
        readFileSync(p, "utf8"),
      ]),
    );

    const anyDynamic = [...importerTexts.values()].some((text) =>
      hasDynamicStylesAccess(text),
    );
    if (anyDynamic) {
      continue;
    }

    const relCss = relative(resolve(import.meta.dirname, ".."), cssAbs);

    for (const className of defined) {
      let used = false;
      for (const edge of cssEdges) {
        const text = importerTexts.get(edge.tsPath) ?? "";
        if (isClassUsedWithBinding(className, text, edge.localName)) {
          used = true;
          break;
        }
      }
      if (!used) {
        errors.push(
          `Unused CSS class ".${className}" in ${relCss} (not referenced via its import binding in any importing file)`,
        );
      }
    }
  }

  if (errors.length) {
    error(errors.join("\n"));
    process.exit(1);
  }
}

main();
