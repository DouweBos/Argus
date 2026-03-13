import * as esbuild from "esbuild";
import fs from "node:fs";

// Bundle the main process into a single file.
// electron and node-pty are external (electron is provided at runtime,
// node-pty is a native addon that must remain in node_modules).
const external = ["electron", "node-pty"];

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external,
  sourcemap: true,
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
