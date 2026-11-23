/**
 * Vendors the web client's pinned mermaid build into the native apps, which
 * render diagrams in a sandboxed web view with no network: ArgusUI's resources
 * (Mac and iPhone) and the Android `:ui` assets.
 *
 *   pnpm gen:mermaid           copy it after bumping mermaid in clients/argus-web
 *   pnpm gen:mermaid --check   fail when a copy differs from the pinned build
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { error, info } from "@argus/host/logger";

const ROOT = path.resolve(import.meta.dirname, "..");
const TARGETS = [
  "clients/apple/ArgusUI/Sources/ArgusUI/Resources/Mermaid/mermaid.min.js",
  "clients/android/ui/src/main/assets/mermaid/mermaid.min.js",
];

const require = createRequire(
  path.join(ROOT, "clients/argus-web/package.json"),
);
const source = path.join(
  path.dirname(require.resolve("mermaid/package.json")),
  "dist/mermaid.min.js",
);
const bytes = fs.readFileSync(source);
const check = process.argv.includes("--check");
let stale = 0;

for (const target of TARGETS) {
  const out = path.join(ROOT, target);
  const current = fs.existsSync(out) ? fs.readFileSync(out) : null;
  if (current?.equals(bytes)) {
    continue;
  }
  if (check) {
    error(`[gen-mermaid] ${target} is out of date; run pnpm gen:mermaid`);
    stale += 1;
    continue;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bytes);
  info(`[gen-mermaid] wrote ${target}`);
}

process.exit(stale > 0 ? 1 : 0);
