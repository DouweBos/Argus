/**
 * `GitErrorKind` exists in three hand-maintained copies: the host owns it, the
 * renderer can't import host code, and Peacock stays isolated from both. A kind
 * added to one and not the others degrades silently — the envelope still
 * rehydrates, but the banner never renders the new case. `signing-failed` had
 * already drifted out of the renderer copy, so all three are compared as source.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Pull the string-literal members of `export type GitErrorKind = …`. */
function kindsIn(file: string): string[] {
  const src = fs.readFileSync(file, "utf-8");
  const block = src.match(/export type GitErrorKind =([\s\S]*?);/);
  if (!block) {
    throw new Error(`no GitErrorKind union in ${file}`);
  }

  return [...block[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
}

describe("gitErrorKind mirror", () => {
  it("keeps all three copies identical", () => {
    const root = path.resolve(__dirname, "../..");
    const host = kindsIn(
      path.join(root, "packages/host/src/services/session/gitError.ts"),
    );
    const renderer = kindsIn(path.join(root, "app/lib/gitError.ts"));
    const peacock = kindsIn(
      path.join(
        root,
        "packages/peacock/src/components/GitErrorBanner/GitErrorBanner.tsx",
      ),
    );

    expect(renderer).toEqual(host);
    expect(peacock).toEqual(host);
  });
});
