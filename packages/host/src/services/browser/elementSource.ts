/**
 * Where a picked element lives in the source: from the framework's own dev
 * hints when it leaves them, else by mapping React's JSX stack through the
 * dev server's source maps. Paths come back relative to the worktree.
 */

import fg from "fast-glob";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inlineSourceMap,
  originalPositionFor,
  type RawSourceMap,
  sourceMappingUrl,
} from "./sourceMap";

/** What the page script collects; every field is the page's word, unchecked. */
export interface SourceHints {
  react?: {
    component?: string;
    fileName?: string;
    lineNumber?: number;
    columnNumber?: number;
    /** React 19's `_debugStack`, which replaced `_debugSource`. */
    stack?: string;
  };
  vue?: { component?: string; file?: string };
  svelte?: {
    file?: string;
    line?: number;
    column?: number;
    zeroBased?: boolean;
  };
  /** The nearest element's source `data-*` attributes from a dev plugin. */
  attributes?: Record<string, string>;
}

export type SourceMethod =
  | "attribute"
  | "none"
  | "react"
  | "sourcemap"
  | "svelte"
  | "vue";

export interface ResolvedSource {
  framework?: "react" | "svelte" | "vue";
  component?: string;
  /** `file:line`, or just the file when no line is known. */
  source?: string;
  method: SourceMethod;
}

interface Location {
  file: string;
  line?: number;
}

export interface SourceContext {
  /** Only scripts from the page's own origin are fetched. */
  pageUrl: string;
  worktree?: string;
  /** Fetches from inside the page, so the dev server sees its own origin. */
  fetchText: (url: string) => Promise<string | null>;
}

/** `src/App.vue:12:5` → file and line; a bare path keeps no line. */
export function parseLocation(value: string): Location | null {
  const match = /^(.+?)(?::(\d+))?(?::(\d+))?$/.exec(value.trim());
  if (!match?.[1]) {
    return null;
  }

  return { file: match[1], line: match[2] ? Number(match[2]) : undefined };
}

/** The dev plugins' attributes: inspector paths, `data-source`, `data-locator`. */
export function sourceFromAttributes(
  attributes: Record<string, string>,
): Location | null {
  const file =
    attributes["data-inspector-relative-path"] ??
    attributes["data-source-file"];
  if (file) {
    const line = Number(
      attributes["data-inspector-line"] ?? attributes["data-source-line"],
    );

    return { file, line: line > 0 ? line : undefined };
  }
  for (const key of [
    "data-v-inspector",
    "data-source",
    "data-source-loc",
    "data-locator",
  ]) {
    const value = attributes[key];
    if (value) {
      return parseLocation(value);
    }
  }

  return null;
}

export interface StackFrame {
  url: string;
  line: number;
  column: number;
}

/** The first frame of app code in a V8 stack, skipping React and dependencies. */
export function appFrame(stack: string): StackFrame | null {
  for (const raw of stack.split("\n").slice(1)) {
    const match =
      /\(?((?:https?|webpack-internal):\/\/[^\s)]+?):(\d+):(\d+)\)?\s*$/.exec(
        raw,
      );
    if (!match) {
      continue;
    }
    const url = match[1];
    if (
      /\/node_modules\/|\/\.vite\/deps\/|react-dom|jsx-dev-runtime|jsx-runtime|\/_next\/static\/chunks\//.test(
        url,
      )
    ) {
      continue;
    }

    return { url, line: Number(match[2]), column: Number(match[3]) };
  }

  return null;
}

/** A source map's `sources` entry as a path in the project. */
export function sourcePath(source: string, base: string): string {
  // `webpack-internal:///(layer)/./src/a.tsx`, `webpack:///./src/a.tsx`, `webpack://app/./src/a.tsx`.
  const bundled =
    /^webpack-internal:\/\/\/(?:\([^)]*\)\/)?(.*)$/.exec(source) ??
    /^webpack:\/\/\/(.*)$/.exec(source) ??
    /^webpack:\/\/[^/]*\/(.*)$/.exec(source);
  if (bundled) {
    return bundled[1].replace(/^\.\//, "");
  }
  if (source.startsWith("file://")) {
    return fileURLToPath(source);
  }
  if (source.startsWith("/") && fs.existsSync(source)) {
    return source;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(source, base).pathname);
  } catch {
    return source;
  }
  // Vite serves files outside its root under `/@fs/<absolute path>`.
  if (pathname.startsWith("/@fs/")) {
    return pathname.slice("/@fs".length);
  }

  return pathname.replace(/^\/+/, "");
}

/**
 * A path made relative to the worktree. A relative one that isn't there (a
 * dev server rooted in a subfolder) is found by suffix when only one file matches.
 */
export async function relativeToWorktree(
  file: string,
  worktree: string | undefined,
): Promise<string> {
  const clean = file.replace(/[?#].*$/, "");
  if (!worktree) {
    return clean;
  }
  if (path.isAbsolute(clean)) {
    const relative = path.relative(worktree, clean);

    return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative
      : clean;
  }
  const relative = clean.replace(/^\.\//, "");
  if (fs.existsSync(path.join(worktree, relative))) {
    return relative;
  }
  const matches = await fg(`**/${fg.escapePath(relative)}`, {
    cwd: worktree,
    ignore: ["**/node_modules/**", "**/.git/**"],
    deep: 8,
    onlyFiles: true,
  }).catch(() => []);

  return matches.length === 1 ? matches[0] : relative;
}

const MAP_CACHE_LIMIT = 32;
const mapCache = new Map<string, RawSourceMap | null>();

async function sourceMapFor(
  scriptUrl: string,
  context: SourceContext,
): Promise<{ map: RawSourceMap; base: string } | null> {
  if (mapCache.has(scriptUrl)) {
    const map = mapCache.get(scriptUrl);

    return map ? { map, base: scriptUrl } : null;
  }
  const script = await context.fetchText(scriptUrl);
  const ref = script ? sourceMappingUrl(script) : null;
  let map: RawSourceMap | null = null;
  let base = scriptUrl;
  if (ref) {
    map = inlineSourceMap(ref);
    if (!map) {
      base = new URL(ref, scriptUrl).href;
      const text = sameOrigin(base, context.pageUrl)
        ? await context.fetchText(base)
        : null;
      map = text ? parseMap(text) : null;
    }
  }
  if (mapCache.size >= MAP_CACHE_LIMIT) {
    mapCache.delete(mapCache.keys().next().value as string);
  }
  mapCache.set(scriptUrl, map);

  return map ? { map, base } : null;
}

function parseMap(text: string): RawSourceMap | null {
  try {
    return JSON.parse(text.replace(/^\)\]\}'[^\n]*\n/, "")) as RawSourceMap;
  } catch {
    return null;
  }
}

function sameOrigin(url: string, pageUrl: string): boolean {
  try {
    const a = new URL(url);

    return /^https?:$/.test(a.protocol) && a.origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

/** A stack frame mapped back to its original file and line. */
export async function mapFrame(
  frame: StackFrame,
  context: SourceContext,
): Promise<Location | null> {
  if (frame.url.startsWith("webpack-internal:")) {
    // Its line is in the transformed module; the path alone is still right.
    return { file: sourcePath(frame.url, frame.url) };
  }
  if (!sameOrigin(frame.url, context.pageUrl)) {
    return null;
  }
  const found = await sourceMapFor(frame.url, context);
  const position = found
    ? originalPositionFor(found.map, frame.line, frame.column)
    : null;

  return position
    ? { file: sourcePath(position.source, found!.base), line: position.line }
    : null;
}

function baseName(file: string | undefined): string | undefined {
  return file ? path.basename(file).replace(/\.[^.]+$/, "") : undefined;
}

export async function resolveElementSource(
  hints: SourceHints | undefined,
  context: SourceContext,
): Promise<ResolvedSource> {
  const { react, vue, svelte, attributes } = hints ?? {};
  const framework = (["react", "vue", "svelte"] as const).find(
    (name) => hints?.[name],
  );
  const component =
    react?.component ??
    vue?.component ??
    baseName(vue?.file) ??
    baseName(svelte?.file);

  let location: Location | null = null;
  let method: SourceMethod = "none";
  const fromAttributes = attributes ? sourceFromAttributes(attributes) : null;
  if (react?.fileName) {
    location = { file: react.fileName, line: react.lineNumber };
    method = "react";
  } else if (svelte?.file) {
    const line =
      typeof svelte.line === "number"
        ? svelte.line + (svelte.zeroBased ? 1 : 0)
        : undefined;
    location = { file: svelte.file, line };
    method = "svelte";
  } else if (fromAttributes) {
    location = fromAttributes;
    method = "attribute";
  } else if (vue?.file) {
    location = { file: vue.file };
    method = "vue";
  } else if (react?.stack) {
    const frame = appFrame(react.stack);
    location = frame ? await mapFrame(frame, context).catch(() => null) : null;
    method = location ? "sourcemap" : "none";
  }

  if (!location) {
    return { framework, component, method: "none" };
  }
  const file = await relativeToWorktree(location.file, context.worktree);

  return {
    framework,
    component,
    source: location.line ? `${file}:${location.line}` : file,
    method,
  };
}
