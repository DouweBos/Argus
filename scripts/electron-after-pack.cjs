/**
 * electron-builder `afterPack` hook.
 *
 * Copies `native/conductor/` into the packaged app's Resources directory.
 * We do this in a hook instead of `extraResources` because electron-builder's
 * default file matcher unconditionally excludes nested `node_modules`
 * directories — even when the filter explicitly requests them — which
 * strips out the conductor runtime we need to ship.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      fs.symlinkSync(target, destPath);
    } else if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

exports.default = async function afterPack(context) {
  const projectRoot = path.resolve(__dirname, "..");
  const src = path.join(projectRoot, "native", "conductor");

  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : path.join(context.appOutDir, "resources");

  const dest = path.join(resourcesDir, "conductor");

  if (!fs.existsSync(src)) {
    throw new Error(
      `afterPack: expected conductor tree at ${src} — run \`tsx scripts/prepare-conductor.ts\` first`,
    );
  }
  const entryPoint = path.join(
    src,
    "node_modules",
    "@houwert",
    "conductor",
    "dist",
    "index.js",
  );
  if (!fs.existsSync(entryPoint)) {
    throw new Error(
      `afterPack: conductor entry point missing at ${entryPoint} — the prepared tree looks incomplete`,
    );
  }

  fs.rmSync(dest, { recursive: true, force: true });
  copyDir(src, dest);

  const copiedEntry = path.join(
    dest,
    "node_modules",
    "@houwert",
    "conductor",
    "dist",
    "index.js",
  );
  if (!fs.existsSync(copiedEntry)) {
    throw new Error(
      `afterPack: copy succeeded but entry point missing at ${copiedEntry}`,
    );
  }
};
