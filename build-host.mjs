import * as esbuild from "esbuild";
import fs from "node:fs";

// The standalone Node host: the same core as the desktop's main process, with
// no Electron on the module graph. Native addons stay in node_modules.
const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const posthogKey =
  process.env.POSTHOG_KEY ?? process.env.VITE_POSTHOG_KEY ?? "";
const posthogHost =
  process.env.POSTHOG_HOST ?? process.env.VITE_POSTHOG_HOST ?? "";

await esbuild.build({
  entryPoints: ["packages/host/src/bin/argus-host.ts"],
  outfile: "dist-host/argus-host.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron", "node-pty", "playwright-core"],
  sourcemap: true,
  define: {
    "process.env.POSTHOG_KEY": JSON.stringify(posthogKey),
    "process.env.POSTHOG_HOST": JSON.stringify(posthogHost),
    "process.env.ARGUS_VERSION": JSON.stringify(pkg.version),
  },
  logLevel: "info",
});

fs.writeFileSync("dist-host/package.json", '{"type":"commonjs"}');
