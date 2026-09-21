/**
 * Rebuild Argus and splice the fresh `dist/` + `dist-electron/` into an
 * installed Argus.app, then relaunch it — no release, no notarization.
 *
 * Works because everything we write lands in those two dirs inside
 * `Contents/Resources/app.asar`; the rest of the bundle is unchanged. Writing
 * to the asar breaks the bundle's sealed-resource hash, so we re-sign with the
 * same Developer ID that signed the release — Gatekeeper is satisfied and the
 * designated requirement is unchanged, so Keychain secrets keep resolving.
 * Electron's asar-integrity fuse is off (we assert that rather than assume it).
 *
 * Override the target with ARGUS_APP=/path/to/Argus.app (defaults to
 * /Applications/Argus.app).
 *
 *   pnpm hotswap              build, swap, relaunch
 *   pnpm hotswap --no-restart leave the running app alone
 *   pnpm hotswap --no-build   swap whatever is already in dist/
 *   pnpm hotswap --web        also refresh the LAN web client
 */
import {
  createPackageWithOptions,
  extractAll,
  getRawHeader,
} from "@electron/asar";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  closeSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const appPath = process.env.ARGUS_APP ?? "/Applications/Argus.app";
const resources = path.join(appPath, "Contents", "Resources");
const asarPath = path.join(resources, "app.asar");

const args = new Set(process.argv.slice(2));
const shouldBuild = !args.has("--no-build");
const shouldRestart = !args.has("--no-restart");
const withWebClient = args.has("--web");

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function step(message: string): void {
  process.stdout.write(`${message}\n`);
}

if (!existsSync(asarPath)) {
  fail(`No app.asar at ${asarPath} (set ARGUS_APP to override).`);
}

/**
 * Electron's fuse wire: a 32-byte sentinel, then version, count, and one ASCII
 * '0'/'1' per fuse. Index 4 is EnableEmbeddedAsarIntegrityValidation — if it
 * were on, a repacked asar would need its hash rewritten into Info.plist, and
 * that breaks the exec-time signature (and with it Keychain access).
 */
function assertAsarIntegrityFuseDisabled(): void {
  const framework = path.join(
    appPath,
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
  );
  if (!existsSync(framework)) {
    return;
  }
  const sentinel = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
  let offset: number;
  try {
    const grep = execFileSync("grep", ["-abo", sentinel, framework], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    offset = Number(grep.split(":")[0]);
  } catch {
    return; // No sentinel found — nothing to assert.
  }
  const fd = openSync(framework, "r");
  const buf = Buffer.alloc(1);
  readSync(fd, buf, 0, 1, offset + sentinel.length + 2 + 4);
  closeSync(fd);
  if (buf.toString("ascii") === "1") {
    fail(
      "This build has Electron's asar integrity fuse enabled — hotswapping would\n" +
        "require rewriting Info.plist and re-signing, which loses Keychain secrets.",
    );
  }
}

/** Unpack roots from the current header, so the repack reproduces them exactly. */
function unpackRoots(): string[] {
  interface Entry {
    files?: Record<string, Entry>;
    unpacked?: boolean;
  }
  const header = getRawHeader(asarPath).header as unknown as Entry;
  const roots: string[] = [];
  const walk = (entry: Entry, prefix: string): void => {
    for (const [name, child] of Object.entries(entry.files ?? {})) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (child.unpacked) {
        roots.push(rel);
        continue; // Nested entries inherit the root.
      }
      walk(child, rel);
    }
  };
  walk(header, "");

  return roots;
}

/** Sorted relative paths under an `app.asar.unpacked` tree. */
function unpackedFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);

      return entry.isDirectory() ? walk(full) : [path.relative(root, full)];
    });

  return walk(root).sort();
}

/** The Developer ID the bundle is currently signed with, if any. */
function signingIdentityOf(target: string): string | undefined {
  // codesign reports on stderr, so this needs spawnSync rather than execFileSync.
  const { stderr } = spawnSync("codesign", ["-d", "-vv", target], {
    encoding: "utf8",
  });

  return /^Authority=(.*(?:Developer ID Application|Apple Development).*)$/m.exec(
    stderr ?? "",
  )?.[1];
}

/** The main process PID of the installed app, if it is running. */
function runningPid(): number | undefined {
  try {
    const out = execFileSync(
      "pgrep",
      ["-f", `^${path.join(appPath, "Contents/MacOS/")}`],
      { encoding: "utf8" },
    );
    const pid = Number(out.trim().split("\n")[0]);

    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Re-seal the bundle. Swapping the asar invalidates CodeResources, and while
 * exec'ing the binary directly still works, `open` runs a full Gatekeeper
 * assessment and rejects it as damaged. Signing with the identity already on
 * the bundle keeps the designated requirement byte-identical, so Keychain
 * items stay readable; the cost is notarization, which only matters for
 * distribution.
 */
function resign(): void {
  const identity =
    process.env.ARGUS_SIGN_IDENTITY ?? signingIdentityOf(appPath);
  if (!identity) {
    fail(
      "Could not read the bundle's signing identity — set ARGUS_SIGN_IDENTITY,\n" +
        "or the relaunched app will be rejected as damaged.",
    );
  }

  const entitlements = path.join(
    mkdtempSync(path.join(os.tmpdir(), "argus-ent-")),
    "entitlements.plist",
  );
  writeFileSync(
    entitlements,
    execFileSync("codesign", ["-d", "--entitlements", ":-", appPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );

  step(`Re-signing as ${identity}…`);
  execFileSync(
    "codesign",
    [
      "--force",
      "--sign",
      identity,
      "--options",
      "runtime",
      "--entitlements",
      entitlements,
      // Offline-friendly; a trusted timestamp only matters for notarization.
      "--timestamp=none",
      appPath,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  rmSync(path.dirname(entitlements), { recursive: true, force: true });

  execFileSync("codesign", ["--verify", "--strict", appPath], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

/**
 * Quit and reopen from a detached session. This has to outlive us: the agent
 * or terminal running the hotswap is a child of Argus, so it dies the moment
 * the app does.
 */
function scheduleRestart(pid: number | undefined): void {
  const script = path.join(
    mkdtempSync(path.join(os.tmpdir(), "argus-relaunch-")),
    "relaunch.sh",
  );
  writeFileSync(
    script,
    `#!/bin/sh
pid="$1"
app="$2"
if [ -n "$pid" ]; then
  kill -TERM "$pid" 2>/dev/null
  i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 40 ]; do sleep 0.25; i=$((i+1)); done
  # The running-agents quit guard can only be answered by the renderer, so a
  # hotswap triggered by an agent always lands here. Sweep the process group
  # to take agent subprocesses and PTYs with it instead of orphaning them.
  if kill -0 "$pid" 2>/dev/null; then
    pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
    [ -n "$pgid" ] && kill -9 "-$pgid" 2>/dev/null
    kill -9 "$pid" 2>/dev/null
    while kill -0 "$pid" 2>/dev/null; do sleep 0.25; done
  fi
fi
sleep 1
open -a "$app"
rm -rf "$(dirname "$0")"
`,
    { mode: 0o755 },
  );

  const child = spawn("/bin/sh", [script, pid ? String(pid) : "", appPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

assertAsarIntegrityFuseDisabled();

if (shouldBuild) {
  step("Building app…");
  execFileSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit" });
}

const dist = path.join(repoRoot, "dist");
const distElectron = path.join(repoRoot, "dist-electron");
if (!existsSync(path.join(dist, "index.html"))) {
  fail(`No renderer build at ${dist} — run without --no-build.`);
}
if (!existsSync(path.join(distElectron, "main.js"))) {
  fail(`No main-process build at ${distElectron} — run without --no-build.`);
}

step("Unpacking app.asar…");
const staging = mkdtempSync(path.join(os.tmpdir(), "argus-hotswap-"));
const tree = path.join(staging, "app");
const roots = unpackRoots();
extractAll(asarPath, tree);

for (const dir of ["dist", "dist-electron"]) {
  rmSync(path.join(tree, dir), { recursive: true, force: true });
}
cpSync(dist, path.join(tree, "dist"), { recursive: true });
cpSync(distElectron, path.join(tree, "dist-electron"), { recursive: true });

step("Repacking…");
const staged = path.join(staging, "app.asar");
await createPackageWithOptions(tree, staged, {
  unpackDir: roots.length === 1 ? roots[0] : `{${roots.join(",")}}`,
});

// Keep the live .unpacked tree and throw the staged copy away: an
// extract/repack round-trip drops the exec bit on node-pty's spawn-helper,
// which would break every terminal. The header's flags still match it, since
// the same paths came back out unpacked. If the set ever diverges the app
// needs a real rebuild, not a hotswap.
const liveUnpacked = `${asarPath}.unpacked`;
const stagedUnpacked = `${staged}.unpacked`;
if (
  unpackedFiles(stagedUnpacked).join("\n") !==
  unpackedFiles(liveUnpacked).join("\n")
) {
  fail("Unpacked native files changed — run `pnpm build:app` and reinstall.");
}
renameSync(staged, asarPath);
rmSync(staging, { recursive: true, force: true });
step(`Swapped into ${appPath}`);

resign();

if (withWebClient) {
  step("Hotswapping web client…");
  execFileSync("pnpm", ["hotswap:web-client"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ARGUS_APP: appPath },
  });
}

// The version in Info.plist is now a lie — the updater will happily "update"
// this app to the release it already claims to be.
step("Installed app no longer matches its version number.");

if (shouldRestart) {
  const pid = runningPid();
  step(pid ? `Relaunching (pid ${pid})…` : "Launching…");
  scheduleRestart(pid);
} else {
  step("Restart Argus to pick up the change.");
}
