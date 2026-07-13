/**
 * Rebuild the LAN web client and copy it into an installed Argus.app, so remote
 * devices pick up the change on a plain refresh — no app restart needed. The
 * gateway serves `Resources/argus-web` fresh from disk per request.
 *
 * Override the target with ARGUS_APP=/path/to/Argus.app (defaults to
 * /Applications/Argus.app).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const appPath = process.env.ARGUS_APP ?? "/Applications/Argus.app";
const dist = path.join(repoRoot, "clients", "argus-web", "dist");
const target = path.join(appPath, "Contents", "Resources", "argus-web");

if (!existsSync(appPath)) {
  process.stderr.write(
    `Argus app not found at ${appPath} (set ARGUS_APP to override).\n`,
  );
  process.exit(1);
}

process.stdout.write("Building web client…\n");
execFileSync("pnpm", ["build:web-client"], { cwd: repoRoot, stdio: "inherit" });

if (!existsSync(path.join(dist, "index.html"))) {
  process.stderr.write(`Build produced no index.html at ${dist}.\n`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const entry of readdirSync(target)) {
  rmSync(path.join(target, entry), { recursive: true, force: true });
}
cpSync(dist, target, { recursive: true });

process.stdout.write(`Swapped web client into ${target}\n`);
process.stdout.write(
  "Refresh the web app on the remote device — no restart needed.\n",
);
