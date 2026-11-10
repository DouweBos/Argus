/**
 * After `changeset version`: writes this release's notes for each app and
 * strips the platform markers from CHANGELOG.md, which stays one list.
 *
 *   release-notes.md       every entry (GitHub release, website)
 *   release-notes-mac.md   the Mac's entries (Sparkle, the Electron cutover feed)
 *   release-notes-ios.md   the iPhone's entries (TestFlight's "What to Test"); empty when it has none
 *
 * An entry without a marker goes to both apps.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MARKER, PLATFORMS, type Platform } from "./platforms";

const root = process.cwd();
const changelogPath = path.join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");

/** The top release's lines: everything between the first two `## ` headings. */
function topSection(md: string): string[] {
  const lines = md.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## "));
  if (start === -1) {
    return [];
  }
  const next = lines.findIndex(
    (line, i) => i > start && line.startsWith("## "),
  );

  return lines.slice(start + 1, next === -1 ? undefined : next);
}

interface Block {
  heading?: string;
  entries: { lines: string[]; platforms: Platform[] }[];
}

function parse(lines: string[]): Block[] {
  const blocks: Block[] = [{ entries: [] }];
  for (const line of lines) {
    const block = blocks[blocks.length - 1];
    if (line.startsWith("### ")) {
      blocks.push({ heading: line, entries: [] });
    } else if (line.startsWith("- ")) {
      const match = MARKER.exec(line);
      const platforms = match
        ? (match[1].split(",").map((p) => p.trim()) as Platform[])
        : [...PLATFORMS];
      block.entries.push({ lines: [line.replace(MARKER, "")], platforms });
    } else if (line.trim() !== "" && block.entries.length > 0) {
      block.entries[block.entries.length - 1].lines.push(line);
    }
  }

  return blocks;
}

function render(blocks: Block[], platform?: Platform): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const entries = block.entries.filter(
      (e) => !platform || e.platforms.includes(platform),
    );
    if (entries.length === 0) {
      continue;
    }
    if (block.heading) {
      parts.push(block.heading, "");
    }
    parts.push(...entries.flatMap((e) => e.lines), "");
  }

  return parts.join("\n").trim();
}

const blocks = parse(topSection(changelog));
const all = render(blocks);
writeFileSync(path.join(root, "release-notes.md"), all ? `${all}\n` : "");
for (const platform of PLATFORMS) {
  const notes = render(blocks, platform);
  writeFileSync(
    path.join(root, `release-notes-${platform}.md`),
    notes ? `${notes}\n` : "",
  );
}
writeFileSync(
  changelogPath,
  changelog.replace(new RegExp(MARKER.source, "g"), ""),
);
