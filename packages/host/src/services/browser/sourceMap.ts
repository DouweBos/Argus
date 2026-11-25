/**
 * Just enough of Source Map v3 to map one generated position back to its
 * original file and line: VLQ mappings, `sourceRoot` and index maps.
 */

export interface RawSourceMap {
  version?: number;
  sources?: (string | null)[];
  sourceRoot?: string;
  mappings?: string;
  sections?: {
    offset: { line: number; column: number };
    map: RawSourceMap;
  }[];
}

export interface OriginalPosition {
  /** As the map names it, `sourceRoot` applied. */
  source: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INDEX = new Map([...BASE64].map((c, i) => [c, i]));

/** The signed numbers of one VLQ segment, e.g. `AAgBC` → [0, 0, 16, 1]. */
export function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64_INDEX.get(char);
    if (digit === undefined) {
      return [];
    }
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }

  return out;
}

/**
 * The original position of a generated one; `line` and `column` are 1-based,
 * as stack traces print them. Null when the map says nothing about it.
 */
export function originalPositionFor(
  map: RawSourceMap,
  line: number,
  column: number,
): OriginalPosition | null {
  if (map.sections) {
    const section = [...map.sections]
      .reverse()
      .find(
        (s) =>
          s.offset.line < line - 1 ||
          (s.offset.line === line - 1 && s.offset.column <= column - 1),
      );
    if (!section) {
      return null;
    }
    const innerLine = line - section.offset.line;
    const innerColumn =
      innerLine === 1 ? column - section.offset.column : column;

    return originalPositionFor(section.map, innerLine, innerColumn);
  }
  const lines = (map.mappings ?? "").split(";");
  const target = line - 1;
  if (target < 0 || target >= lines.length) {
    return null;
  }
  // Source index and original line/column carry over from line to line.
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let best: OriginalPosition | null = null;
  for (let l = 0; l <= target; l++) {
    let generatedColumn = 0;
    for (const segment of lines[l].split(",")) {
      if (!segment) {
        continue;
      }
      const fields = decodeVlq(segment);
      if (fields.length === 0) {
        continue;
      }
      generatedColumn += fields[0];
      if (fields.length < 4) {
        if (l === target && generatedColumn <= column - 1) {
          best = null;
        }
        continue;
      }
      sourceIndex += fields[1];
      originalLine += fields[2];
      originalColumn += fields[3];
      if (l === target && generatedColumn <= column - 1) {
        const source = map.sources?.[sourceIndex];
        best = source
          ? {
              source: withRoot(map.sourceRoot, source),
              line: originalLine + 1,
              column: originalColumn + 1,
            }
          : null;
      }
    }
  }

  return best;
}

function withRoot(root: string | undefined, source: string): string {
  if (!root || /^[a-z][\w+.-]*:|^\//i.test(source)) {
    return source;
  }

  return root.endsWith("/") ? root + source : `${root}/${source}`;
}

/** The last `sourceMappingURL` comment in a script, as written. */
export function sourceMappingUrl(script: string): string | null {
  const matches = [...script.matchAll(/[#@]\s*sourceMappingURL=([^\s'"*]+)/g)];

  return matches.length ? matches[matches.length - 1][1] : null;
}

/** A `data:` map inline in the script; null for one that must be fetched. */
export function inlineSourceMap(url: string): RawSourceMap | null {
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!match) {
    return null;
  }
  try {
    const text = match[1]
      ? Buffer.from(match[2], "base64").toString("utf-8")
      : decodeURIComponent(match[2]);

    return JSON.parse(text) as RawSourceMap;
  } catch {
    return null;
  }
}
