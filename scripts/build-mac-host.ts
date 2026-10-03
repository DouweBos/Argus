/**
 * Stage the Node host into the Mac app: `Contents/Resources/host/`.
 *
 *   host/
 *   ├── node                         the pinned runtime (mise.toml), hardened
 *   ├── argus-host.js                the dist-host bundle
 *   ├── node_modules/node-pty        the addon + spawn-helper for this arch
 *   └── resources/                   ARGUS_RESOURCES: sim-bridge, conductor,
 *                                    scrcpy jar, emulator proto, prompts, docs,
 *                                    argus-web
 *
 * Driven by the ArgusDesktop target's build phase, which passes `--out` and the
 * identity Xcode is signing with. Xcode never signs code nested in Resources,
 * so this does: every Mach-O with the hardened runtime, and `node` with the JIT
 * entitlements it can't run without.
 *
 *   tsx scripts/build-mac-host.ts --out <dir> [--sign <identity>] [--skip-build]
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTITLEMENTS = path.join(
  ROOT,
  "clients/apple/ArgusDesktop/Host.entitlements",
);

interface Options {
  out: string;
  sign: string | null;
  skipBuild: boolean;
}

function parseArgs(argv: string[]): Options {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);

    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const out = value("--out");
  if (!out) {
    throw new Error("--out <dir> is required");
  }
  const sign = value("--sign");

  return {
    out: path.resolve(out),
    // Xcode's "Sign to Run Locally" hands us "-": ad-hoc, still hardened.
    sign: sign && sign.length > 0 ? sign : null,
    skipBuild: argv.includes("--skip-build"),
  };
}

function log(line: string): void {
  process.stdout.write(`[build-mac-host] ${line}\n`);
}

/**
 * Mirror `src` into `dest`, copying only what changed. `--update` keeps a copy
 * we signed (newer than its source) until the source itself moves on.
 */
function sync(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const isDir = fs.statSync(src).isDirectory();
  execFileSync("rsync", [
    "-a",
    "--update",
    "--delete",
    "--copy-links",
    isDir ? `${src}/` : src,
    dest,
  ]);
}

/** Resources the host resolves through `ARGUS_RESOURCES`, as electron-builder ships them. */
const RESOURCES: { from: string; to: string; optional?: boolean }[] = [
  { from: "native/argus-sim-bridge/argus-sim-bridge", to: "argus-sim-bridge" },
  {
    from: "native/argus-sim-input/argus-sim-input",
    to: "argus-sim-input",
    optional: true,
  },
  { from: "native/scrcpy-server/scrcpy-server.jar", to: "scrcpy-server.jar" },
  {
    from: "native/emulator-proto/emulator_controller.proto",
    to: "emulator_controller.proto",
  },
  {
    from: "packages/host/prompts/worktree-agent-system-prompt.md",
    to: "worktree-agent-system-prompt.md",
  },
  {
    from: "packages/host/prompts/root-agent-system-prompt.md",
    to: "root-agent-system-prompt.md",
  },
  {
    from: "packages/host/prompts/org-host-agent-system-prompt.md",
    to: "org-host-agent-system-prompt.md",
    optional: true,
  },
  { from: "docs/project-settings.md", to: "docs/project-settings.md" },
  { from: "native/conductor", to: "conductor" },
  { from: "clients/argus-web/dist", to: "argus-web", optional: true },
];

function stage(options: Options): void {
  if (!options.skipBuild) {
    execFileSync(process.execPath, ["build-host.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    // The gateway serves the browser client; build it once rather than ship
    // an app whose web address answers 404.
    if (!fs.existsSync(path.join(ROOT, "clients/argus-web/dist/index.html"))) {
      execFileSync("pnpm", ["build:web-client"], {
        cwd: ROOT,
        stdio: "inherit",
      });
    }
  }
  const out = options.out;
  fs.mkdirSync(out, { recursive: true });

  stageNode(out, options.sign);
  sync(
    path.join(ROOT, "dist-host/argus-host.js"),
    path.join(out, "argus-host.js"),
  );
  sync(
    path.join(ROOT, "dist-host/package.json"),
    path.join(out, "package.json"),
  );

  const pty = fs.realpathSync(path.join(ROOT, "node_modules/node-pty"));
  const ptyOut = path.join(out, "node_modules/node-pty");
  sync(path.join(pty, "package.json"), path.join(ptyOut, "package.json"));
  sync(path.join(pty, "lib"), path.join(ptyOut, "lib"));
  const prebuild = `prebuilds/${process.platform}-${process.arch}`;
  sync(path.join(pty, prebuild), path.join(ptyOut, prebuild));

  for (const resource of RESOURCES) {
    const src = path.join(ROOT, resource.from);
    if (!fs.existsSync(src)) {
      if (resource.optional) {
        log(`skipping ${resource.from} (not built)`);
        continue;
      }
      throw new Error(`missing ${resource.from}`);
    }
    sync(src, path.join(out, "resources", resource.to));
  }
}

/**
 * The runtime running this script is the one mise.toml pins. Signing changes
 * the copy, so a stamp — not rsync — decides whether it is current; otherwise
 * every build would copy and re-sign 100 MB.
 */
function stageNode(out: string, identity: string | null): void {
  const src = fs.realpathSync(process.execPath);
  const dest = path.join(out, "node");
  const stampFile = path.join(out, ".node-stamp");
  const stamp = JSON.stringify({
    src,
    mtime: fs.statSync(src).mtimeMs,
    identity,
    entitlements: fs.readFileSync(ENTITLEMENTS, "utf8"),
  });
  if (fs.existsSync(dest) && fs.readFileSync(stampFile, "utf8") === stamp) {
    return;
  }
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  if (identity) {
    signFile(dest, identity, true);
  }
  fs.writeFileSync(stampFile, stamp);
}

function signFile(file: string, identity: string, jit: boolean): void {
  execFileSync("codesign", [
    "--force",
    "--sign",
    identity,
    "--options",
    "runtime",
    identity === "-" ? "--timestamp=none" : "--timestamp",
    ...(jit ? ["--entitlements", ENTITLEMENTS] : []),
    file,
  ]);
}

function isMachO(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const magic = Buffer.alloc(4);
    if (fs.readSync(fd, magic, 0, 4, 0) < 4) {
      return false;
    }
    const value = magic.readUInt32BE(0);

    return [
      0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
    ].includes(value);
  } finally {
    fs.closeSync(fd);
  }
}

function machOFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...machOFiles(full));
    } else if (entry.isFile() && isMachO(full)) {
      found.push(full);
    }
  }

  return found;
}

function isSignedBy(file: string, identity: string): boolean {
  const verify = spawnSync("codesign", ["--verify", "--strict", file]);
  if (verify.status !== 0) {
    return false;
  }
  // `codesign -dvv` reports on stderr; ad-hoc signatures carry no authority.
  const info = spawnSync("codesign", ["-dvv", file], { encoding: "utf8" });
  if (!/flags=0x[0-9a-f]+\(.*runtime.*\)/.test(info.stderr)) {
    return false;
  }

  return identity === "-"
    ? info.stderr.includes("Signature=adhoc")
    : info.stderr.includes(`Authority=${identity}`);
}

function signNested(out: string, identity: string): void {
  const node = path.join(out, "node");
  const files = machOFiles(out).filter((file) => file !== node);
  let signed = 0;
  for (const file of files) {
    // rsync only replaced what changed, and a replaced file fails verification.
    if (!isSignedBy(file, identity)) {
      signFile(file, identity, false);
      signed += 1;
    }
  }
  log(`signed ${signed} of ${files.length} nested binaries`);
}

const options = parseArgs(process.argv.slice(2));
stage(options);
if (options.sign) {
  signNested(options.out, options.sign);
}
log(`staged ${options.out}`);
