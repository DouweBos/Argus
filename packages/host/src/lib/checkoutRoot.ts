/**
 * Root of the repo checkout an unpackaged host runs from. Found from this
 * module's own location — the source tree or `dist-host/` — so a host started
 * from any working directory still reads its prompts and assets.
 */

import fs from "node:fs";
import path from "node:path";

/** Present in every checkout, wherever the code itself is loaded from. */
const MARKER = path.join("packages", "host", "prompts");

let cached: string | null = null;

export function checkoutRoot(): string {
  if (cached) {
    return cached;
  }
  cached = findUp(__dirname) ?? findUp(process.cwd()) ?? process.cwd();

  return cached;
}

function findUp(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, MARKER))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
