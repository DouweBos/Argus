/**
 * Quick-open matching over a session's relative paths, fzf style: the query
 * is a case-insensitive subsequence of the path; matches in the file name, at
 * word boundaries (`/`, `_`, `-`, `.`, camelCase) and in runs score higher.
 * Build once per file list, then `search` per keystroke. The TS twin of
 * ArgusCore's `FuzzyFileMatcher`; both share test vectors.
 */

export interface FuzzyMatch {
  path: string;
  score: number;
  /** UTF-16 offsets into `path` of the matched characters, for highlighting. */
  indices: number[];
  isBoosted: boolean;
}

export interface FuzzySearchOptions {
  /** Paths (changed files) that rank above the rest. */
  boost?: ReadonlySet<string>;
  limit?: number;
}

const SLASH = 0x2f;
const SPACE = 0x20;
const BOOST_BONUS = 2 ** 40;

function fold(unit: number): number {
  return unit >= 0x41 && unit <= 0x5a ? unit | 0x20 : unit;
}

function needleOf(query: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < query.length; i += 1) {
    const unit = query.charCodeAt(i);
    if (unit !== SPACE) {
      out.push(fold(unit));
    }
  }

  return out;
}

/** The shortest stretch ending at the first complete match (fzf's v1 forward/backward scan). */
function window(
  needle: number[],
  path: string,
  start: number,
): [number, number] | null {
  let j = 0;
  let end = -1;
  for (let i = start; i < path.length; i += 1) {
    if (fold(path.charCodeAt(i)) === needle[j]) {
      j += 1;
      if (j === needle.length) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    return null;
  }
  j = needle.length - 1;
  let begin = end;
  while (begin >= start) {
    if (fold(path.charCodeAt(begin)) === needle[j]) {
      if (j === 0) {
        break;
      }
      j -= 1;
    }
    begin -= 1;
  }

  return [begin, end];
}

function pick(
  needle: number[],
  path: string,
  [from, to]: [number, number],
): number[] {
  const indices: number[] = [];
  let j = 0;
  for (let i = from; i <= to && j < needle.length; i += 1) {
    if (fold(path.charCodeAt(i)) === needle[j]) {
      indices.push(i);
      j += 1;
    }
  }

  return indices;
}

function boundaryBonus(index: number, path: string): number {
  if (index <= 0) {
    return 10;
  }
  const previous = path.charCodeAt(index - 1);
  if (previous === SLASH) {
    return 10;
  }
  // _ - . space
  if (
    previous === 0x5f ||
    previous === 0x2d ||
    previous === 0x2e ||
    previous === SPACE
  ) {
    return 8;
  }
  const isLower = previous >= 0x61 && previous <= 0x7a;
  const current = path.charCodeAt(index);
  const isUpper = current >= 0x41 && current <= 0x5a;

  return isLower && isUpper ? 7 : 0;
}

function rate(indices: number[], path: string, baseOffset: number): number {
  let score = 0;
  let previous = -2;
  let streak = 0;
  for (const index of indices) {
    score += 16;
    score += boundaryBonus(index, path);
    if (index === previous + 1) {
      streak += 1;
      score += 4 * Math.min(streak, 4);
    } else {
      streak = 0;
      if (previous >= 0) {
        score -= Math.min(index - previous - 1, 12);
      }
    }
    previous = index;
  }
  const first = indices[0];
  if (first !== undefined && first >= baseOffset) {
    score += 24;
    if (first === baseOffset) {
      score += 12;
    }
    if (indices.length === path.length - baseOffset) {
      score += 24;
    }
  }

  // Ties go to the shorter path.
  return score * 1024 - path.length;
}

function scorePath(
  needle: number[],
  path: string,
  baseOffset: number,
): { score: number; indices: number[] } | null {
  if (needle.length === 0) {
    return { score: 0, indices: [] };
  }
  // A match inside the file name beats the same letters spread over directories.
  if (baseOffset > 0) {
    const inName = window(needle, path, baseOffset);
    if (inName) {
      const indices = pick(needle, path, inName);

      return { score: rate(indices, path, baseOffset), indices };
    }
  }
  const whole = window(needle, path, 0);
  if (!whole) {
    return null;
  }
  const indices = pick(needle, path, whole);

  return { score: rate(indices, path, baseOffset), indices };
}

function baseOffsetOf(path: string): number {
  return path.lastIndexOf("/") + 1;
}

export class FuzzyFileMatcher {
  readonly paths: readonly string[];
  private readonly baseOffsets: number[];

  constructor(paths: readonly string[]) {
    this.paths = paths;
    this.baseOffsets = paths.map(baseOffsetOf);
  }

  /**
   * Best matches first, at most `limit`. Boosted paths rank above the rest;
   * an empty query lists them first, then the others in their original order.
   */
  search(
    query: string,
    { boost, limit = 50 }: FuzzySearchOptions = {},
  ): FuzzyMatch[] {
    const needle = needleOf(query);
    const boosted = boost ?? new Set<string>();
    if (needle.length === 0) {
      const first = this.paths.filter((p) => boosted.has(p));
      const rest: string[] = [];
      for (const p of this.paths) {
        if (first.length + rest.length >= limit) {
          break;
        }
        if (!boosted.has(p)) {
          rest.push(p);
        }
      }

      return [...first, ...rest].slice(0, limit).map((path) => ({
        path,
        score: 0,
        indices: [],
        isBoosted: boosted.has(path),
      }));
    }
    const scored: { index: number; score: number; indices: number[] }[] = [];
    this.paths.forEach((path, index) => {
      const match = scorePath(needle, path, this.baseOffsets[index]);
      if (!match) {
        return;
      }
      const score = boosted.has(path) ? match.score + BOOST_BONUS : match.score;
      scored.push({ index, score, indices: match.indices });
    });
    scored.sort((a, b) =>
      a.score !== b.score ? b.score - a.score : a.index - b.index,
    );

    return scored.slice(0, limit).map((entry) => ({
      path: this.paths[entry.index],
      score: entry.score,
      indices: entry.indices,
      isBoosted: entry.score >= BOOST_BONUS,
    }));
  }

  /** One path against one query, for callers that don't keep an index. */
  static match(
    query: string,
    path: string,
  ): { score: number; indices: number[] } | null {
    return scorePath(needleOf(query), path, baseOffsetOf(path));
  }
}

/** A matched path as a row shows it: the file name and its directory, each with its own offsets. */
export function splitMatchedPath(
  path: string,
  indices: readonly number[],
): {
  name: string;
  nameIndices: number[];
  directory: string;
  directoryIndices: number[];
} {
  const base = baseOffsetOf(path);

  return {
    name: path.slice(base),
    nameIndices: indices.filter((i) => i >= base).map((i) => i - base),
    directory: base > 0 ? path.slice(0, base - 1) : "",
    directoryIndices: indices.filter((i) => i < base - 1),
  };
}
