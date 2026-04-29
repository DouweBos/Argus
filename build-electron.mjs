import * as esbuild from "esbuild";
import fs from "node:fs";

// Bundle the main process into a single file.
// electron and node-pty are external (electron is provided at runtime,
// node-pty is a native addon that must remain in node_modules).
const external = ["electron", "node-pty", "playwright-core"];

// Build-time inlined secrets. esbuild's `define` substitutes the literal
// string into the bundle, mirroring what Vite does for `import.meta.env.VITE_*`
// in the renderer. Without this, `process.env.POSTHOG_KEY` is read at
// runtime on the user's machine (where it is empty) and main-process
// telemetry stays dormant in packaged builds.
//
// CI sets POSTHOG_KEY / POSTHOG_HOST for main and VITE_POSTHOG_KEY /
// VITE_POSTHOG_HOST for the renderer (both from the same secret). Locally
// either name works.
const posthogKey =
  process.env.POSTHOG_KEY ?? process.env.VITE_POSTHOG_KEY ?? "";
const posthogHost =
  process.env.POSTHOG_HOST ?? process.env.VITE_POSTHOG_HOST ?? "";

const define = {
  "process.env.POSTHOG_KEY": JSON.stringify(posthogKey),
  "process.env.POSTHOG_HOST": JSON.stringify(posthogHost),
};

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external,
  sourcemap: true,
  define,
  logLevel: "info",
};

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: ["electron/main.ts"],
    outfile: "dist-electron/main.js",
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["electron/preload.ts"],
    outfile: "dist-electron/preload.js",
  }),
]);

// Write CJS package.json so Node treats .js as CommonJS
fs.writeFileSync("dist-electron/package.json", '{"type":"commonjs"}');
