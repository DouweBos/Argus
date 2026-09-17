// Distribution build configuration. Driven by `fastlane release`, which
// exports the signing + notarization env vars and the channel selection
// (ARGUS_CHANNEL = latest | beta | alpha) before invoking electron-builder.
//
// We use a JS config instead of YAML because electron-builder's
// `--config.publish.0.<key>` CLI overrides replace array entries instead of
// merging them, which strips the `provider` field and fails schema validation.

const channel = process.env.ARGUS_CHANNEL || "latest";
const isPrerelease = channel !== "latest";

module.exports = {
  appId: "dev.houwert.argus",
  productName: "Argus",
  directories: {
    buildResources: "build",
    output: "release",
  },
  files: [
    "dist/**/*",
    "dist-electron/**/*",
    "!node_modules/**/*",
    "node_modules/node-pty/**/*",
  ],
  extraResources: [
    {
      from: "build/menu-icons",
      to: "menu-icons",
      filter: ["**/*.png"],
    },
    // Tool assets — bundled into the app. The tool store gates *use* behind
    // the user's enable toggle, but the binaries always ship with Argus.
    // (The conductor tree is copied in via the `afterPack` hook because
    // electron-builder's default matcher strips nested `node_modules` even
    // with explicit filters.)
    {
      from: "native/argus-sim-bridge/argus-sim-bridge",
      to: "argus-sim-bridge",
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
    },
    { from: "docs/project-settings.md", to: "docs/project-settings.md" },
    // The LAN web client bundle, served by the remote gateway from
    // `process.resourcesPath/argus-web`. Built by `pnpm build:web-client`
    // before packaging; without this entry the gateway has no static dir and
    // answers every request with "426 upgrade required".
    { from: "clients/argus-web/dist", to: "argus-web" },
  ],
  afterPack: "scripts/electron-after-pack.cjs",
  mac: {
    // Distribution build — signed with Developer ID, notarized, stapled.
    identity: "Douwe Bos (CKZT75PN5T)",
    target: [
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ],
    category: "public.app-category.developer-tools",
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize: true,
    extendInfo: {
      NSDesktopFolderUsageDescription:
        "Argus needs access to your Desktop so agents can read and edit files in projects you keep there.",
      NSDocumentsFolderUsageDescription:
        "Argus needs access to your Documents so agents can read and edit files in projects you keep there.",
      NSDownloadsFolderUsageDescription:
        "Argus needs access to your Downloads so agents can read files you've downloaded into projects.",
      NSRemovableVolumesUsageDescription:
        "Argus needs access to removable volumes so agents can read files from external drives.",
      NSNetworkVolumesUsageDescription:
        "Argus needs access to network volumes so agents can read files from mounted shares.",
      NSAppleEventsUsageDescription:
        "Argus uses Apple Events to control developer tools (simulators, terminals) on your behalf.",
      NSSystemAdministrationUsageDescription:
        "Argus performs system administration tasks to manage simulators, emulators, and developer tooling.",
      NSCameraUsageDescription:
        "Argus needs camera access to display video from connected capture cards and cameras.",
    },
  },
  publish: [
    // Auto-update channel: clients fetch latest-mac.yml + delta blockmaps +
    // the signed installer through the houwert.dev reverse proxy
    // (see houwert.dev/functions/argus/updates/[[path]].ts), which
    // authenticates to GitHub Releases on behalf of the user. Listed first so
    // the runtime autoUpdater uses it as the feed; `initUpdater()` also pins
    // this URL explicitly via `setFeedURL` as a belt-and-braces guard.
    {
      provider: "generic",
      url: "https://houwert.dev/argus/updates",
      channel,
      useMultipleRangeRequest: true,
    },
    // Secondary publish target: GitHub Releases on the (private) Argus repo.
    // electron-builder uploads the .dmg / .zip / latest-mac.yml here from CI.
    // The houwert.dev/argus/updates proxy reads those off the matching GitHub
    // release, so `publishAutoUpdate` must stay at its default (true) — the
    // generic provider above is read-only and can't accept uploads.
    {
      provider: "github",
      owner: "DouweBos",
      repo: "Argus",
      releaseType: isPrerelease ? "prerelease" : "release",
    },
  ],
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  asar: true,
};
