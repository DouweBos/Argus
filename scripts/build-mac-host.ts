/**
 * Stage the Node host into the Mac app: `Contents/Resources/host/`.
 *
 *   host/
 *   ├── node                         the pinned runtime (mise.toml), hardened
 *   ├── argus-host.js                the dist-host bundle
 *   ├── node_modules/node-pty        the addon + spawn-helper for this arch
 *   └── resources/                   ARGUS_RESOURCES: sim-bridge, sim-input, conductor,
 *                                    scrcpy jar, emulator proto, prompts, docs,
 *                                    argus-web, rg, language-servers
 *
 * Driven by the ArgusDesktop target's build phase, which passes `--out` and the
 * identity Xcode is signing with. Xcode never signs code nested in Resources,
 * so this does: every Mach-O with the hardened runtime, and `node` with the JIT
 * entitlements it can't run without.
 *
 *   tsx scripts/build-mac-host.ts --out <dir> [--sign <identity>] [--app <bundle>] [--skip-build]
 *
 * `--app` names the app bundle. Xcode skips its own CodeSign when no Swift
 * changed, so when staging changed the bundle this reseals it, or the app
 * fails verification.
 */

import * as esbuild from "esbuild";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTITLEMENTS = path.join(
  ROOT,
  "clients/apple/ArgusDesktop/Host.entitlements",
);
const SIM_INPUT_ENTITLEMENTS = path.join(
  ROOT,
  "build/entitlements.sim-input.plist",
);

interface Options {
  out: string;
  sign: string | null;
  app: string | null;
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
    app: value("--app"),
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
/** `byContent` for unsigned files rebuilt every run with the same bytes. */
function sync(src: string, dest: string, byContent = false): boolean {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const isDir = fs.statSync(src).isDirectory();
  const changes = execFileSync(
    "rsync",
    [
      "-a",
      byContent ? "--checksum" : "--update",
      "--delete",
      "--copy-links",
      "--itemize-changes",
      isDir ? `${src}/` : src,
      dest,
    ],
    { encoding: "utf8" },
  );

  // Itemized lines for directories whose only change is their own mtime don't count.
  return changes
    .split("\n")
    .some((line) => line.length > 0 && !/^\.d\.\.t/.test(line));
}

/** Resources the host resolves through `ARGUS_RESOURCES`, as electron-builder ships them. */
const RESOURCES: { from: string; to: string; optional?: boolean }[] = [
  { from: "native/argus-sim-bridge/argus-sim-bridge", to: "argus-sim-bridge" },
  { from: "native/argus-sim-input/argus-sim-input", to: "argus-sim-input" },
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

const HOST_MODULES = path.join(ROOT, "packages/host/node_modules");

/**
 * Language servers that ship as many small modules, bundled to one file each
 * (`module` first: their UMD builds `require` dynamically, which esbuild can't
 * follow). Resolved by `services/lsp/servers.ts` under `language-servers/`.
 */
const LANGUAGE_SERVER_BUNDLES: Record<string, string> = {
  json: "vscode-langservers-extracted/lib/json-language-server/node/jsonServerMain.js",
  css: "vscode-langservers-extracted/lib/css-language-server/node/cssServerMain.js",
  html: "vscode-langservers-extracted/lib/html-language-server/node/htmlServerMain.js",
  yaml: "yaml-language-server/out/server/src/server.js",
};

/** ripgrep and the bundled language servers, as `services/code/bundled.ts` finds them. */
function stageCodeTools(out: string): boolean {
  const resources = path.join(out, "resources");
  const servers = path.join(resources, "language-servers");
  const rgPackage = fs.realpathSync(path.join(HOST_MODULES, "@vscode/ripgrep"));
  let changed = sync(
    path.join(
      path.dirname(rgPackage),
      `ripgrep-${process.platform}-${process.arch}`,
      "bin/rg",
    ),
    path.join(resources, "rg"),
  );
  const tsls = fs.realpathSync(
    path.join(HOST_MODULES, "typescript-language-server"),
  );
  for (const file of ["package.json", "lib/cli.mjs"]) {
    changed =
      sync(
        path.join(tsls, file),
        path.join(servers, "typescript-language-server", file),
      ) || changed;
  }
  const typescript = fs.realpathSync(
    path.join(HOST_MODULES, "bundled-typescript"),
  );
  for (const entry of ["package.json", "lib"]) {
    changed =
      sync(
        path.join(typescript, entry),
        path.join(servers, "typescript", entry),
      ) || changed;
  }
  changed =
    sync(
      path.join(HOST_MODULES, "yaml-language-server/l10n"),
      path.join(servers, "yaml-l10n"),
    ) || changed;

  const built = path.join(ROOT, "dist-host/language-servers");
  for (const [name, entry] of Object.entries(LANGUAGE_SERVER_BUNDLES)) {
    esbuild.buildSync({
      entryPoints: [path.join(HOST_MODULES, entry)],
      outfile: path.join(built, `${name}.js`),
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      mainFields: ["module", "main"],
      logLevel: "warning",
    });
    changed =
      sync(
        path.join(built, `${name}.js`),
        path.join(servers, `${name}.js`),
        true,
      ) || changed;
  }

  return changed;
}

function stage(options: Options): boolean {
  if (!options.skipBuild) {
    execFileSync(process.execPath, ["build-host.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    // Neither helper is checked in, and a build without the input helper has
    // no keyboard or hardware buttons on any simulator. Make is incremental.
    for (const dir of ["native/argus-sim-bridge", "native/argus-sim-input"]) {
      execFileSync("make", ["-C", dir], { cwd: ROOT, stdio: "inherit" });
    }
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

  let changed = stageNode(out, options.sign);
  changed =
    sync(
      path.join(ROOT, "dist-host/argus-host.js"),
      path.join(out, "argus-host.js"),
      true,
    ) || changed;
  changed =
    sync(
      path.join(ROOT, "dist-host/package.json"),
      path.join(out, "package.json"),
      true,
    ) || changed;

  const pty = fs.realpathSync(path.join(ROOT, "node_modules/node-pty"));
  const ptyOut = path.join(out, "node_modules/node-pty");
  changed =
    sync(path.join(pty, "package.json"), path.join(ptyOut, "package.json")) ||
    changed;
  changed = sync(path.join(pty, "lib"), path.join(ptyOut, "lib")) || changed;
  const prebuild = `prebuilds/${process.platform}-${process.arch}`;
  changed =
    sync(path.join(pty, prebuild), path.join(ptyOut, prebuild)) || changed;

  changed = stageCodeTools(out) || changed;

  for (const resource of RESOURCES) {
    const src = path.join(ROOT, resource.from);
    if (!fs.existsSync(src)) {
      if (resource.optional) {
        log(`skipping ${resource.from} (not built)`);
        continue;
      }
      throw new Error(`missing ${resource.from}`);
    }
    changed = sync(src, path.join(out, "resources", resource.to)) || changed;
  }

  return changed;
}

/**
 * The runtime running this script is the one mise.toml pins. Signing changes
 * the copy, so a stamp — not rsync — decides whether it is current; otherwise
 * every build would copy and re-sign 100 MB.
 */
function stageNode(out: string, identity: string | null): boolean {
  const src = fs.realpathSync(process.execPath);
  const dest = path.join(out, "node");
  const stampFile = path.join(out, ".node-stamp");
  const stamp = JSON.stringify({
    src,
    mtime: fs.statSync(src).mtimeMs,
    identity,
    entitlements: fs.readFileSync(ENTITLEMENTS, "utf8"),
  });
  if (
    fs.existsSync(dest) &&
    fs.existsSync(stampFile) &&
    fs.readFileSync(stampFile, "utf8") === stamp
  ) {
    return false;
  }
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  if (identity) {
    signFile(dest, identity, ENTITLEMENTS);
  }
  fs.writeFileSync(stampFile, stamp);

  return true;
}

function signFile(
  file: string,
  identity: string,
  entitlements: string | null,
): void {
  execFileSync("codesign", [
    "--force",
    "--sign",
    identity,
    "--options",
    "runtime",
    identity === "-" ? "--timestamp=none" : "--timestamp",
    ...(entitlements ? ["--entitlements", entitlements] : []),
    file,
  ]);
}

function entitlementsFor(file: string): string | null {
  return path.basename(file) === "argus-sim-input"
    ? SIM_INPUT_ENTITLEMENTS
    : null;
}

/** Signed before the helper had its entitlement, it can't launch. */
function hasEntitlements(file: string, entitlements: string | null): boolean {
  if (!entitlements) {
    return true;
  }
  const info = spawnSync(
    "codesign",
    ["-d", "--entitlements", "-", "--xml", file],
    { encoding: "utf8" },
  );

  return info.stdout.includes("allow-dyld-environment-variables");
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
    : info.stderr.includes(`Authority=${identityName(identity)}`);
}

/**
 * Re-sign an app whose seal this run broke. A bundle Xcode hasn't signed yet
 * (a clean build) is left alone: its own CodeSign step comes after this one.
 */
function reseal(app: string, identity: string): void {
  if (!fs.existsSync(app)) {
    return;
  }
  const signed = spawnSync("codesign", ["-dv", app]);
  const valid = spawnSync("codesign", ["--verify", "--deep", "--strict", app]);
  if (signed.status !== 0 || valid.status === 0) {
    return;
  }
  const result = spawnSync("codesign", [
    "--force",
    "--sign",
    identity,
    "--preserve-metadata=identifier,entitlements,requirements,flags,runtime",
    "--timestamp=none",
    app,
  ]);
  log(
    result.status === 0
      ? "staging changed the bundle; resealed the app"
      : `couldn't reseal the app: ${result.stderr.toString().trim()}`,
  );
}

/** Xcode passes the certificate's SHA-1; `codesign -dvv` reports its name. */
function identityName(identity: string): string {
  if (!/^[0-9A-F]{40}$/i.test(identity)) {
    return identity;
  }
  const list = spawnSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    {
      encoding: "utf8",
    },
  );
  const line = list.stdout
    .split("\n")
    .find((entry) => entry.toUpperCase().includes(identity.toUpperCase()));

  return line?.match(/"(.+)"/)?.[1] ?? identity;
}

function signNested(out: string, identity: string): number {
  const node = path.join(out, "node");
  const files = machOFiles(out).filter((file) => file !== node);
  let signed = 0;
  for (const file of files) {
    // rsync only replaced what changed, and a replaced file fails verification.
    const entitlements = entitlementsFor(file);
    if (!isSignedBy(file, identity) || !hasEntitlements(file, entitlements)) {
      signFile(file, identity, entitlements);
      signed += 1;
    }
  }
  log(`signed ${signed} of ${files.length} nested binaries`);

  return signed;
}

const options = parseArgs(process.argv.slice(2));
let changed = stage(options);
if (options.sign) {
  changed = signNested(options.out, options.sign) > 0 || changed;
}
if (changed && options.sign && options.app) {
  reseal(options.app, options.sign);
}
log(`staged ${options.out}`);
