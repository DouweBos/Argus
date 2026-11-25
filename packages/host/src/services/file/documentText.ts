/**
 * Plain text out of the documents an agent can't read itself: Word, PowerPoint
 * and Excel files (zipped XML) and RTF. Pure apart from `textutil` for RTF.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { readZipEntry, type ZipEntry, zipEntries } from "../../lib/zip";

const run = promisify(execFile);

export type DocumentKind = "docx" | "pptx" | "rtf" | "xlsx";

/** Bigger files are left to the agent's `@path`. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** One XML part, decompressed. */
const MAX_PART_BYTES = 32 * 1024 * 1024;
/** What one document may add to a message. */
export const MAX_DOCUMENT_CHARS = 100_000;

export function documentKind(file: string): DocumentKind | null {
  const ext = path.extname(file).slice(1).toLowerCase();

  return ext === "docx" || ext === "pptx" || ext === "xlsx" || ext === "rtf"
    ? ext
    : null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);

      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }

    return ENTITIES[name] ?? whole;
  });
}

/** Paragraphs of a WordprocessingML or DrawingML part, one per line. */
export function paragraphText(
  xml: string,
  paragraph: string,
  textTag: string,
): string {
  const lines: string[] = [];
  const paragraphs = new RegExp(
    `<${paragraph}(?:\\s[^>]*?)?/>|<${paragraph}(?:\\s[^>]*)?>[\\s\\S]*?</${paragraph}>`,
    "g",
  );
  const pieces = new RegExp(
    `<${textTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${textTag}>|<w:tab/>|<w:br/>|<a:br/>`,
    "g",
  );
  for (const [p] of xml.matchAll(paragraphs)) {
    let line = "";
    for (const piece of p.matchAll(pieces)) {
      if (piece[1] !== undefined) {
        line += decode(piece[1]);
      } else {
        line += piece[0] === "<w:tab/>" ? "\t" : "\n";
      }
    }
    lines.push(line);
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function part(
  bytes: Buffer,
  entries: ZipEntry[],
  name: string,
): string | undefined {
  const entry = entries.find((e) => e.name === name);

  return entry
    ? readZipEntry(bytes, entry, MAX_PART_BYTES)?.toString("utf8")
    : undefined;
}

function numbered(entries: ZipEntry[], pattern: RegExp): string[] {
  return entries
    .map((e) => e.name)
    .filter((name) => pattern.test(name))
    .sort(
      (a, b) =>
        Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]),
    );
}

function docxText(bytes: Buffer, entries: ZipEntry[]): string | null {
  const body = part(bytes, entries, "word/document.xml");

  return body === undefined ? null : paragraphText(body, "w:p", "w:t");
}

function pptxText(bytes: Buffer, entries: ZipEntry[]): string | null {
  const slides = numbered(entries, /^ppt\/slides\/slide\d+\.xml$/);
  if (slides.length === 0) {
    return null;
  }

  return slides
    .map((name, i) => {
      const text = paragraphText(
        part(bytes, entries, name) ?? "",
        "a:p",
        "a:t",
      );

      return `Slide ${String(i + 1)}\n${text}`.trim();
    })
    .join("\n\n");
}

/** Column letters of `A1`-style references to a zero-based index. */
function column(reference: string): number {
  let n = 0;
  for (const c of reference.replace(/\d+$/, "")) {
    n = n * 26 + (c.charCodeAt(0) - 64);
  }

  return n - 1;
}

/** Each sheet as tab-separated rows under its name. */
export function xlsxText(bytes: Buffer, entries: ZipEntry[]): string | null {
  const workbook = part(bytes, entries, "xl/workbook.xml");
  if (workbook === undefined) {
    return null;
  }
  const strings = [
    ...(part(bytes, entries, "xl/sharedStrings.xml") ?? "").matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map(([, si]) =>
    [...(si ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map(([, t]) => decode(t ?? ""))
      .join(""),
  );
  const rels = new Map(
    [
      ...(part(bytes, entries, "xl/_rels/workbook.xml.rels") ?? "").matchAll(
        /<Relationship\b[^>]*>/g,
      ),
    ].map(([tag]) => [
      /\bId="([^"]+)"/.exec(tag)?.[1],
      /\bTarget="([^"]+)"/.exec(tag)?.[1],
    ]),
  );
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(([tag], i) => {
    const target = rels.get(/\br:id="([^"]+)"/.exec(tag)?.[1]);
    const file = target
      ? path.posix.join("xl", target.replace(/^\/?xl\//, ""))
      : `xl/worksheets/sheet${String(i + 1)}.xml`;

    return { name: decode(/\bname="([^"]*)"/.exec(tag)?.[1] ?? ""), file };
  });

  return sheets
    .map(({ name, file }) => {
      const xml = part(bytes, entries, file) ?? "";
      const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(
        ([, row]) => {
          const cells: string[] = [];
          for (const [, attrs, inner] of (row ?? "").matchAll(
            /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
          )) {
            const ref = /\br="([A-Z]+\d+)"/.exec(attrs ?? "")?.[1];
            const type = /\bt="(\w+)"/.exec(attrs ?? "")?.[1];
            const value = /<v>([\s\S]*?)<\/v>/.exec(inner ?? "")?.[1];
            const inline = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(
              inner ?? "",
            )?.[1];
            const text =
              type === "s"
                ? (strings[Number(value)] ?? "")
                : decode(inline ?? value ?? "");
            cells[ref ? column(ref) : cells.length] = text;
          }

          return Array.from(cells, (c) => c ?? "").join("\t");
        },
      );

      return `Sheet: ${name}\n${rows.join("\n")}`.trim();
    })
    .join("\n\n");
}

/** RTF without its control words, for when `textutil` isn't there. */
export function stripRtf(rtf: string): string {
  let depth = 0;
  let skipFrom = -1;
  let out = "";
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i]!;
    if (c === "{") {
      depth++;
      // Destinations like fonttbl, colortbl, `{\*\...}` hold no body text.
      if (
        skipFrom < 0 &&
        /^\{\\(\*|fonttbl|colortbl|stylesheet|info|pict)/.test(
          rtf.slice(i, i + 12),
        )
      ) {
        skipFrom = depth;
      }
      continue;
    }
    if (c === "}") {
      if (depth === skipFrom) {
        skipFrom = -1;
      }
      depth--;
      continue;
    }
    if (c === "\\") {
      const next = rtf[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        if (skipFrom < 0) {
          out += next;
        }
        i++;
        continue;
      }
      // A backslash before a line break is a paragraph break, as `textutil` writes them.
      if (next === "\n" || next === "\r") {
        if (skipFrom < 0) {
          out += "\n";
        }
        i++;
        continue;
      }
      if (next === "'") {
        if (skipFrom < 0) {
          out += String.fromCharCode(parseInt(rtf.slice(i + 2, i + 4), 16));
        }
        i += 3;
        continue;
      }
      const word = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40));
      if (word) {
        if (skipFrom < 0) {
          if (word[1] === "par" || word[1] === "line") {
            out += "\n";
          } else if (word[1] === "tab") {
            out += "\t";
          } else if (word[1] === "u" && word[2]) {
            out += String.fromCharCode((Number(word[2]) + 65536) % 65536);
          }
        }
        i += word[0].length - 1;
        continue;
      }
      i++;
      continue;
    }
    if (skipFrom < 0 && c !== "\r" && c !== "\n") {
      out += c;
    }
  }

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

async function rtfText(file: string, bytes: Buffer): Promise<string> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await run(
        "/usr/bin/textutil",
        ["-convert", "txt", "-stdout", file],
        { maxBuffer: MAX_PART_BYTES, timeout: 10_000 },
      );

      return stdout.trim();
    } catch {
      // Falls through to the stripper.
    }
  }

  return stripRtf(bytes.toString("latin1"));
}

/** The document's text, or null when it can't be read as its kind. */
export async function extractDocumentText(
  file: string,
  kind: DocumentKind,
): Promise<string | null> {
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_DOCUMENT_BYTES) {
    return null;
  }
  const bytes = await fs.promises.readFile(file);
  if (kind === "rtf") {
    return rtfText(file, bytes);
  }
  const entries = zipEntries(bytes);
  if (!entries) {
    return null;
  }
  switch (kind) {
    case "docx":
      return docxText(bytes, entries);
    case "pptx":
      return pptxText(bytes, entries);
    case "xlsx":
      return xlsxText(bytes, entries);
  }
}
