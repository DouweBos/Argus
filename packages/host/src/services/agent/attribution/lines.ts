/** Who wrote each line of a file, and carrying that across a change to it. */

import crypto from "node:crypto";
import { matchLines } from "./lineDiff";

export type LineAuthor = "agent" | "human";

/** 1-based, inclusive. */
export interface AttributedRange {
  author: LineAuthor;
  end: number;
  start: number;
}

/** A file as attribution last saw it: a hash per line and who wrote it, null for neither. */
export interface FileLines {
  authors: (LineAuthor | null)[];
  hashes: string[];
}

/** Lines as a diff counts them: no trailing empty line for a final newline, no `\r`. */
export function splitLines(content: string): string[] {
  if (content === "") {
    return [];
  }
  const lines = content.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

export function lineHash(line: string): string {
  return crypto
    .createHash("sha1")
    .update(line)
    .digest("base64url")
    .slice(0, 12);
}

export function unattributed(lines: readonly string[]): FileLines {
  return { hashes: lines.map(lineHash), authors: lines.map(() => null) };
}

/**
 * The file after a change: lines it still has keep their author, the others
 * get what `decide` says about their text.
 */
export function reconcile(
  prev: FileLines,
  next: readonly string[],
  decide: (line: string) => LineAuthor | null,
): FileLines {
  const hashes = next.map(lineHash);
  const map = matchLines(prev.hashes, hashes);
  const authors = next.map((line, i) => {
    const old = map[i]!;

    return old >= 0 ? (prev.authors[old] ?? null) : decide(line);
  });

  return { hashes, authors };
}

/** The file as it is now without deciding anything: changed lines carry no mark. */
export function project(prev: FileLines, next: readonly string[]): FileLines {
  return reconcile(prev, next, () => null);
}

export function toRanges(
  authors: readonly (LineAuthor | null)[],
): AttributedRange[] {
  const ranges: AttributedRange[] = [];
  for (let i = 0; i < authors.length; i++) {
    const author = authors[i];
    if (!author) {
      continue;
    }
    const last = ranges.at(-1);
    if (last && last.author === author && last.end === i) {
      last.end = i + 1;
    } else {
      ranges.push({ author, start: i + 1, end: i + 1 });
    }
  }

  return ranges;
}

export function fromRanges(
  ranges: readonly AttributedRange[],
  count: number,
): (LineAuthor | null)[] {
  const authors: (LineAuthor | null)[] = Array.from(
    { length: count },
    () => null,
  );
  for (const range of ranges) {
    for (let line = range.start; line <= Math.min(range.end, count); line++) {
      authors[line - 1] = range.author;
    }
  }

  return authors;
}
