/**
 * Merges and ranks quick open's sources. Exact names, then prefixes, then
 * fuzzy matches; within each, changed files (and the symbols in them) first,
 * then by fuzzy score; types before members. The TS twin of ArgusCore's
 * `QuickOpenRanker`.
 */

import type { CodeSymbol, CodeSymbolKind } from "@argus/remote-protocol";
import { FuzzyFileMatcher } from "./fuzzyFileMatcher";

/** One row of quick open, with the UTF-16 offsets of its matched characters. */
export type QuickOpenResult =
  | {
      kind: "symbol";
      symbol: CodeSymbol;
      indices: number[];
      boosted: boolean;
    }
  | { kind: "file"; path: string; indices: number[]; boosted: boolean };

export function quickOpenResultId(result: QuickOpenResult): string {
  if (result.kind === "file") {
    return `f:${result.path}`;
  }
  const s = result.symbol;

  return `s:${s.relativePath}:${s.line}:${s.column}:${s.name}`;
}

export function quickOpenResultPath(result: QuickOpenResult): string {
  return result.kind === "file" ? result.path : result.symbol.relativePath;
}

interface Scored {
  tier: number;
  boosted: boolean;
  score: number;
  result: QuickOpenResult;
}

const KIND_ORDER: CodeSymbolKind[] = [
  "class",
  "struct",
  "enum",
  "protocol",
  "interface",
  "extension",
  "type_alias",
  "module",
  "constructor",
  "method",
  "function",
  "property",
  "constant",
  "variable",
  "enum_member",
  "other",
];

function kindOrder(kind: CodeSymbolKind): number {
  const index = KIND_ORDER.indexOf(kind);

  return index === -1 ? KIND_ORDER.length : index;
}

function kindBonus(kind: CodeSymbolKind): number {
  switch (kind) {
    case "class":
    case "struct":
    case "enum":
    case "interface":
    case "protocol":
    case "type_alias":
      return 2;
    case "function":
    case "method":
      return 1;
    default:
      return 0;
  }
}

/** 3: the whole name, 2: its start, 1: anywhere. */
function tier(name: string, needle: string): number {
  if (name === needle) {
    return 3;
  }

  return name.startsWith(needle) ? 2 : 1;
}

function sorted(scored: Scored[], limit: number): QuickOpenResult[] {
  return [...scored]
    .sort((a, b) => {
      if (a.tier !== b.tier) {
        return b.tier - a.tier;
      }
      if (a.boosted !== b.boosted) {
        return a.boosted ? -1 : 1;
      }

      return b.score - a.score;
    })
    .slice(0, limit)
    .map((s) => s.result);
}

function scoreSymbols(
  query: string,
  symbols: readonly CodeSymbol[],
  changed: ReadonlySet<string>,
): Scored[] {
  const needle = query.toLowerCase();
  const out: Scored[] = [];
  for (const symbol of symbols) {
    const match = FuzzyFileMatcher.match(query, symbol.name);
    if (!match) {
      continue;
    }
    const boosted = changed.has(symbol.relativePath);
    out.push({
      tier: tier(symbol.name.toLowerCase(), needle),
      boosted,
      score: match.score + kindBonus(symbol.kind) * 16,
      result: { kind: "symbol", symbol, indices: match.indices, boosted },
    });
  }

  return out;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(0, dot) : name;
}

/** The host's index and the language servers' answers as one list, the servers' copy kept. */
export function mergeSymbols(
  host: readonly CodeSymbol[],
  lsp: readonly CodeSymbol[],
): CodeSymbol[] {
  const seen = new Set<string>();

  return [...lsp, ...host].filter((s) => {
    const key = `${s.relativePath}\u0000${s.line}\u0000${s.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    return true;
  });
}

export function rankSymbols(
  query: string,
  symbols: readonly CodeSymbol[],
  changed: ReadonlySet<string>,
  limit = 50,
): QuickOpenResult[] {
  return sorted(scoreSymbols(query, symbols, changed), limit);
}

/** Open Quickly: `files` ranked together with `symbols`. */
export function rankMixed(
  query: string,
  files: readonly string[],
  symbols: readonly CodeSymbol[],
  changed: ReadonlySet<string>,
  limit = 50,
): QuickOpenResult[] {
  const needle = query.toLowerCase();
  const scored: Scored[] = [];
  for (const path of files) {
    const match = FuzzyFileMatcher.match(query, path);
    if (!match) {
      continue;
    }
    const name = fileName(path).toLowerCase();
    const boosted = changed.has(path);
    scored.push({
      tier: Math.max(tier(stemOf(name), needle), tier(name, needle)),
      boosted,
      score: match.score,
      result: { kind: "file", path, indices: match.indices, boosted },
    });
  }

  return sorted([...scored, ...scoreSymbols(query, symbols, changed)], limit);
}

/** `@`: the file's symbols in order, or fuzzy-ranked once there's a query. `grouped` sorts by kind. */
export function rankFileSymbols(
  query: string,
  symbols: readonly CodeSymbol[],
  grouped: boolean,
): QuickOpenResult[] {
  if (query.length === 0) {
    const ordered = grouped
      ? symbols
          .map((symbol, offset) => ({ symbol, offset }))
          .sort(
            (a, b) =>
              kindOrder(a.symbol.kind) - kindOrder(b.symbol.kind) ||
              a.offset - b.offset,
          )
          .map((e) => e.symbol)
      : symbols;

    return ordered.map((symbol) => ({
      kind: "symbol",
      symbol,
      indices: [],
      boosted: false,
    }));
  }

  return rankSymbols(query, symbols, new Set(), 200);
}
