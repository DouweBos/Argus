/**
 * Extract the section for the current package.json version from CHANGELOG.md
 * and write it to a file electron-builder can read via
 * `--config.releaseInfo.releaseNotesFile`.
 *
 * Run before `pnpm exec electron-builder` (the release fastlane lane wires
 * this up automatically). Falls back to a minimal "Argus vX.Y.Z" stub when
 * the version section can't be found, so a missing CHANGELOG entry never
 * blocks a release build.
 *
 * Usage: tsx scripts/extract-release-notes.ts [outputPath]
 *   - outputPath defaults to ./release-notes.md
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outPath = path.resolve(root, process.argv[2] ?? "release-notes.md");
const changelogPath = path.join(root, "CHANGELOG.md");
const pkgPath = path.join(root, "package.json");

const version = JSON.parse(readFileSync(pkgPath, "utf8")).version as string;
const changelog = readFileSync(changelogPath, "utf8");

function extractSection(md: string, target: string): string | null {
  // CHANGELOG.md is in changesets format: each release is a `## <version>`
  // heading. Capture from the matching heading up to the next `## ` line.
  const lines = md.split("\n");
  const startMarker = `## ${target}`;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === startMarker) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) {
    return null;
  }
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trim();
}

const section = extractSection(changelog, version);
const body =
  section && section.length > 0
    ? section
    : `Argus ${version} — see https://github.com/DouweBos/Argus/releases for details.`;

writeFileSync(outPath, body, "utf8");
// eslint-disable-next-line no-console
console.log(`Wrote release notes for v${version} to ${outPath}`);
