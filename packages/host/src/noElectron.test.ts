/**
 * The load-bearing invariant of `@argus/host`: the core is plain Node.
 *
 * Nothing under `src/` may reach for `electron`, directly or transitively —
 * that is what lets a Linux box or a CLI run sessions and agents. Anything
 * needing the desktop shell goes through `HostPlatform` instead.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }

    return entry.isFile() && full.endsWith(".ts") ? [full] : [];
  });
}

const ELECTRON_IMPORT =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']electron(?:\/[^"']*)?["']/;

describe("@argus/host", () => {
  it("never imports electron", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      ELECTRON_IMPORT.test(fs.readFileSync(file, "utf8")),
    );

    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("does not depend on electron in its manifest", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(SRC, "..", "package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;

    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
    ]) {
      expect(Object.keys(manifest[field] ?? {})).not.toContain("electron");
    }
  });
});
