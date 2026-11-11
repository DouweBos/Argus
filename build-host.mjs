import * as esbuild from "esbuild";
import fs from "node:fs";

// The standalone Node host the Mac app and Argus Server bundle, and `argus-host`
// runs. Native addons stay in node_modules.
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
  external: ["node-pty", "playwright-core"],
  sourcemap: true,
  define: {
    "process.env.POSTHOG_KEY": JSON.stringify(posthogKey),
    "process.env.POSTHOG_HOST": JSON.stringify(posthogHost),
    "process.env.ARGUS_VERSION": JSON.stringify(pkg.version),
  },
  logLevel: "info",
});

// The stdio MCP bridge agents without HTTP MCP spawn; it sits next to the host.
await esbuild.build({
  entryPoints: ["packages/host/src/bin/argus-mcp-stdio.ts"],
  outfile: "dist-host/argus-mcp-stdio.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  logLevel: "info",
});

fs.writeFileSync("dist-host/package.json", '{"type":"commonjs"}');
