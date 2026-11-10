/**
 * The changesets changelog generator: the stock line format, plus a marker
 * naming the changeset's platforms so a release can give the Mac and the
 * iPhone their own notes. release-notes.ts strips the markers again.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { changesetPlatforms, platformMarker } from "./platforms";

interface Changeset {
  id: string;
  summary: string;
  commit?: string;
}

/** Runs before `changeset version` deletes the files, so the raw frontmatter is still there. */
function markerFor(id: string): string {
  const file = path.join(process.cwd(), ".changeset", `${id}.md`);
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const platforms = changesetPlatforms(raw);

  return platforms ? ` ${platformMarker(platforms)}` : "";
}

async function getReleaseLine(changeset: Changeset): Promise<string> {
  const [firstLine, ...rest] = changeset.summary
    .split("\n")
    .map((line) => line.trimEnd());
  const commit = changeset.commit ? `${changeset.commit.slice(0, 7)}: ` : "";
  let line = `- ${commit}${firstLine}${markerFor(changeset.id)}`;
  if (rest.length > 0) {
    line += `\n${rest.map((l) => `  ${l}`).join("\n")}`;
  }

  return line;
}

async function getDependencyReleaseLine(): Promise<string> {
  return "";
}

const changelogFunctions = { getReleaseLine, getDependencyReleaseLine };

export default changelogFunctions;
