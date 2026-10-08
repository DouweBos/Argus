/**
 * One ripgrep run for the symbol index: every indexed file's candidate lines
 * as JSON, turned into definitions file by file as rg finishes each.
 */

import type { CodeSymbol } from "@argus/remote-protocol";
import { type ChildProcess, spawn } from "node:child_process";
import readline from "node:readline";
import { createLogger } from "@argus/host/logger";
import { ripgrepPath } from "./bundled";
import {
  extractSymbols,
  indexedExtensions,
  languageForPath,
  prefilterPatterns,
} from "./symbolRules";

const log = createLogger("code-symbols");

/** Longer lines are minified or generated: no definitions worth listing. */
const MAX_LINE = 1000;

export interface SessionIndex {
  sessionId: string;
  root: string;
  files: Map<string, CodeSymbol[]>;
  building: Promise<void> | null;
  children: Set<ChildProcess>;
  /** HEAD at build time; a new one means the tree may have changed wholesale. */
  head: string | null;
  stale: boolean;
  /** Path → mtime of the files git listed as changed last time. */
  dirty: Map<string, number | null>;
  lastUsed: number;
  evictTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  /** Shares one string per distinct name or container. */
  names: Map<string, string>;
}

interface RgLine {
  type: string;
  data: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number | null;
  };
}

/** A copy that doesn't pin the line it was sliced from, shared across the index. */
function intern(index: SessionIndex, value: string): string {
  const known = index.names.get(value);
  if (known !== undefined) {
    return known;
  }
  const copy =
    value.length > 12 ? Buffer.from(value, "utf8").toString("utf8") : value;
  index.names.set(copy, copy);

  return copy;
}

function rgArgs(): string[] {
  const args = [
    "--json",
    "--no-config",
    "--no-messages",
    "--max-filesize",
    "1M",
  ];
  for (const ext of indexedExtensions()) {
    args.push("--glob", `*.${ext}`);
  }
  args.push("--glob", "!*.min.js");
  for (const pattern of prefilterPatterns()) {
    args.push("--regexp", pattern);
  }

  return args;
}

function store(
  index: SessionIndex,
  relativePath: string,
  lines: { line: number; text: string }[],
): void {
  const language = languageForPath(relativePath);
  if (!language) {
    return;
  }
  const file = intern(index, relativePath);
  const symbols = extractSymbols(language, lines).map(
    (s): CodeSymbol => ({
      name: intern(index, s.name),
      kind: s.kind,
      ...(s.container ? { container: intern(index, s.container) } : {}),
      relativePath: file,
      line: s.line,
      column: s.column,
    }),
  );
  if (symbols.length) {
    index.files.set(file, symbols);
  } else {
    index.files.delete(file);
  }
}

/** Runs ripgrep over `paths` (the whole tree when empty), storing each file as it finishes. */
export function scan(index: SessionIndex, paths: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      ripgrepPath(),
      [...rgArgs(), "--", ...(paths.length ? paths : ["."])],
      {
        cwd: index.root,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    index.children.add(child);
    let current: string | null = null;
    let lines: { line: number; text: string }[] = [];
    const flush = () => {
      if (current !== null) {
        store(index, current, lines);
      }
      current = null;
      lines = [];
    };
    readline.createInterface({ input: child.stdout }).on("line", (raw) => {
      if (
        !raw.startsWith('{"type":"match"') &&
        !raw.startsWith('{"type":"end"')
      ) {
        return;
      }
      let event: RgLine;
      try {
        event = JSON.parse(raw) as RgLine;
      } catch {
        return;
      }
      const file = event.data.path?.text?.replace(/^\.\//, "");
      if (file === undefined) {
        return;
      }
      if (event.type === "end") {
        if (file === current) {
          flush();
        }

        return;
      }
      if (file !== current) {
        flush();
        current = file;
      }
      const text = event.data.lines?.text?.replace(/\r?\n$/, "");
      if (
        text !== undefined &&
        text.length <= MAX_LINE &&
        event.data.line_number
      ) {
        lines.push({ line: event.data.line_number, text });
      }
    });
    child.once("error", (err) => {
      log.error(`could not run ripgrep: ${err.message}`);
    });
    child.once("close", () => {
      flush();
      index.children.delete(child);
      resolve();
    });
  });
}
