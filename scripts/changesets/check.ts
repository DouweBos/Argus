/**
 * Fails when a pending changeset doesn't say which app it's for, so a release
 * never sends the iPhone the Mac's notes. See docs/releases.md.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { changesetPlatforms, PLATFORMS } from "./platforms";

const dir = path.join(process.cwd(), ".changeset");
const missing = readdirSync(dir)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .filter(
    (name) =>
      changesetPlatforms(readFileSync(path.join(dir, name), "utf8")) === null,
  );

if (missing.length > 0) {
  process.stderr.write(
    `These changesets don't name their app. Add \`# platforms: ${PLATFORMS.join(", ")}\` (one or both) to the frontmatter:\n` +
      missing.map((name) => `  .changeset/${name}`).join("\n") +
      "\n",
  );
  process.exit(1);
}
