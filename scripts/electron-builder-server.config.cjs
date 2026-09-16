/**
 * electron-builder config for the headless `Argus Server.app`.
 *
 * Derived from `electron-builder.yml` so the two targets can't drift on
 * resources: the server still ships argus-sim-bridge, scrcpy-server.jar, the
 * agent prompts and the argus-web bundle (it is what serves that), and still
 * runs the same afterPack hook for the conductor tree.
 *
 * What differs: a distinct appId — the single-instance lock is keyed on the
 * userData path derived from it, so this is the only reason a server and a
 * desktop can run on one Mac — a `dist-electron/server.js` entry point, no DMG,
 * no Dock tile, and none of the usage strings that only a window can trigger.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("yaml");

const base = yaml.parse(
  fs.readFileSync(path.join(__dirname, "..", "electron-builder.yml"), "utf8"),
);

// Window-only prompts. The folder-access strings stay: agents read and write
// real projects on this machine.
const WINDOW_ONLY_USAGE_KEYS = ["NSCameraUsageDescription"];

const extendInfo = { ...base.mac.extendInfo };
for (const key of WINDOW_ONLY_USAGE_KEYS) {
  delete extendInfo[key];
}

module.exports = {
  ...base,
  appId: "dev.houwert.argus.server",
  // Its own output dir so a server build never stomps the desktop one.
  directories: { ...base.directories, output: "release-server" },
  productName: "Argus Server",
  // Merged into the packaged package.json — this is what makes the bundle boot
  // the server entry (which sets ARGUS_SERVER before any module loads).
  extraMetadata: { main: "dist-electron/server.js" },
  // `icon.png` is the Dock tile, which a background app never shows. The
  // menu-icons stay: the tray is the server's only UI.
  extraResources: base.extraResources.filter(
    (entry) => entry.from !== "build/icon.png",
  ),
  dmg: undefined,
  mac: {
    ...base.mac,
    extendInfo: {
      ...extendInfo,
      // Background app: tray item, no Dock tile, no app switcher entry.
      LSUIElement: 1,
    },
  },
};
