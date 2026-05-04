/* eslint-disable no-console -- this is a release-pipeline script that runs on CI; console output is the user-facing log. */
/**
 * Package plugin assets and upload them to the GitHub release for the
 * current app version. Invoked by `fastlane mac release` after the main
 * `.app` is built and notarized.
 *
 * Per-plugin steps:
 *   1. Stage the asset under `release/plugin-staging/<plugin>/<asset>`.
 *   2. For native binaries: codesign + zip + notarize + staple.
 *   3. For node trees / jars / data: zip without signing.
 *   4. Upload each `.zip` as an asset on the GH release tag `v<version>`.
 *
 * The renderer's asset resolver (`electron/services/plugins/assets.ts`) reads
 * exactly the same names from
 * `<reverse-proxy>/releases/v<version>/<plugin>/<asset>-<arch>-<platform>.zip`
 * (native) or `…/<asset>.zip` (everything else), so any change to the asset
 * filenames here MUST be mirrored there.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface PluginAssetSpec {
  pluginId: string;
  /** Source file or directory in the repo. */
  source: string;
  /** Output asset name (chunk 11's resolver uses this verbatim). */
  outputName: string;
  /** When true, codesign + notarize. False = JVM/Node payload, no signing. */
  notarize: boolean;
  /** When true, name the zip with arch/platform suffix. False = portable. */
  perArch: boolean;
  /** chmod +x the source before zipping (Mach-O binaries). */
  executable?: boolean;
}

const REPO_ROOT = path.resolve(__dirname, "..");
const STAGING = path.join(REPO_ROOT, "release", "plugin-staging");

const ASSETS: PluginAssetSpec[] = [
  {
    pluginId: "device-recording",
    source: path.join(
      REPO_ROOT,
      "native",
      "argus-sim-bridge",
      "argus-sim-bridge",
    ),
    outputName: "argus-sim-bridge",
    notarize: true,
    perArch: true,
    executable: true,
  },
  {
    pluginId: "device-recording",
    source: path.join(
      REPO_ROOT,
      "native",
      "scrcpy-server",
      "scrcpy-server.jar",
    ),
    outputName: "scrcpy-server.jar",
    notarize: false,
    perArch: false,
  },
  {
    pluginId: "device-control",
    source: path.join(REPO_ROOT, "native", "conductor"),
    outputName: "conductor",
    notarize: false,
    perArch: false,
  },
];

function readVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );

  return pkg.version as string;
}

function archSlug(): string {
  return process.arch;
}

function platformSlug(): string {
  switch (process.platform) {
    case "darwin":
      return "darwin";
    case "win32":
      return "win32";
    case "linux":
      return "linux";
    default:
      return process.platform;
  }
}

function run(cmd: string, args: string[], cwd?: string): void {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    cwd: cwd ?? REPO_ROOT,
    stdio: "inherit",
  });
}

function zipName(spec: PluginAssetSpec): string {
  if (spec.perArch) {
    return `${spec.outputName}-${archSlug()}-${platformSlug()}.zip`;
  }

  return `${spec.outputName}.zip`;
}

function ditto(args: string[]): void {
  run("ditto", args);
}

function codesignBinary(filePath: string): void {
  const identity = process.env.CSC_NAME;
  if (!identity) {
    throw new Error("CSC_NAME env var required for native asset signing");
  }
  run("codesign", [
    "--sign",
    identity,
    "--force",
    "--timestamp",
    "--options",
    "runtime",
    filePath,
  ]);
}

function notarizeZip(zipPath: string): void {
  const keyId = process.env.APP_STORE_CONNECT_API_KEY_ID;
  const issuer = process.env.APP_STORE_CONNECT_API_KEY_ISSUER_ID;
  const keyPath = process.env.APPLE_API_KEY;
  if (!keyId || !issuer || !keyPath) {
    throw new Error(
      "APP_STORE_CONNECT_* env vars must be set (set by fastlane prepare_notarize_env)",
    );
  }
  run("xcrun", [
    "notarytool",
    "submit",
    zipPath,
    "--key",
    keyPath,
    "--key-id",
    keyId,
    "--issuer",
    issuer,
    "--wait",
  ]);
}

function staple(file: string): void {
  // Notarytool can't staple raw binaries, only bundles/dmgs. For a single
  // Mach-O the notarization ticket lives in Apple's CDN and Gatekeeper
  // fetches it on first run — so stapling is a nice-to-have, not required.
  // Keeping the helper here in case we move to .app-style bundles later.
  run("xcrun", ["stapler", "staple", file]);
}

async function packageAsset(spec: PluginAssetSpec): Promise<{
  zipPath: string;
  uploadName: string;
}> {
  const dest = path.join(STAGING, spec.pluginId);
  fs.mkdirSync(dest, { recursive: true });

  const stagedSource = path.join(dest, spec.outputName);
  // Copy the source into staging so we can chmod / sign without mutating the
  // checked-in tree.
  fs.cpSync(spec.source, stagedSource, { recursive: true });

  if (spec.executable) {
    fs.chmodSync(stagedSource, 0o755);
  }
  if (spec.notarize) {
    codesignBinary(stagedSource);
  }

  const outZip = path.join(dest, zipName(spec));
  ditto(["-c", "-k", "--keepParent", stagedSource, outZip]);

  if (spec.notarize) {
    notarizeZip(outZip);
    // Single-binary stapling is no-op; ignore failure.
    try {
      staple(stagedSource);
    } catch {
      // intentional
    }
  }

  return { zipPath: outZip, uploadName: path.basename(outZip) };
}

async function uploadToRelease(
  tag: string,
  pluginId: string,
  zipPath: string,
): Promise<void> {
  // gh CLI handles auth via GITHUB_TOKEN. We rename the asset on upload to
  // include the plugin id as a directory-style prefix so the resolver can
  // construct the URL deterministically: `<plugin>/<filename>`.
  const target = `${pluginId}/${path.basename(zipPath)}`;
  // GH releases don't support real subdirs; we encode the plugin id in the
  // filename instead. The resolver already builds the full path, but the GH
  // download URL is flat. Use a `<plugin>__<filename>` convention so the
  // reverse proxy can rewrite it back into a subpath.
  const flatName = `${pluginId}__${path.basename(zipPath)}`;
  const renamed = path.join(path.dirname(zipPath), flatName);
  fs.copyFileSync(zipPath, renamed);
  run("gh", [
    "release",
    "upload",
    tag,
    renamed,
    "--clobber",
    "--repo",
    process.env.GITHUB_REPOSITORY ?? "DouweBos/Argus",
  ]);
  console.log(`Uploaded plugin asset: ${target} → ${flatName}`);
}

async function main(): Promise<void> {
  const version = readVersion();
  const tag = `v${version}`;
  console.log(`Packaging plugin assets for ${tag}`);

  fs.rmSync(STAGING, { recursive: true, force: true });
  fs.mkdirSync(STAGING, { recursive: true });

  for (const spec of ASSETS) {
    if (!fs.existsSync(spec.source)) {
      console.warn(
        `Skipping ${spec.outputName}: source missing at ${spec.source}`,
      );
      continue;
    }
    const { zipPath } = await packageAsset(spec);
    if (process.env.SKIP_UPLOAD === "1") {
      console.log(`SKIP_UPLOAD=1 — leaving ${zipPath} on disk`);
      continue;
    }
    await uploadToRelease(tag, spec.pluginId, zipPath);
  }

  console.log("Plugin asset release complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
