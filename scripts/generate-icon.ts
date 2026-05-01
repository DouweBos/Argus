/**
 * Rasterize `build/icon.svg` into `build/icon.iconset/`, then build
 * `build/icon.icns` and `build/icon.png` for electron-builder.
 *
 * Run with: pnpm build:icon
 */
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../app/lib/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dirname, "..", "build");
const SVG = join(BUILD, "icon.svg");
const ICONSET = join(BUILD, "icon.iconset");

const SIZES: { name: string; size: number }[] = [
  { name: "icon_16x16.png", size: 16 },
  { name: "icon_16x16@2x.png", size: 32 },
  { name: "icon_32x32.png", size: 32 },
  { name: "icon_32x32@2x.png", size: 64 },
  { name: "icon_128x128.png", size: 128 },
  { name: "icon_128x128@2x.png", size: 256 },
  { name: "icon_256x256.png", size: 256 },
  { name: "icon_256x256@2x.png", size: 512 },
  { name: "icon_512x512.png", size: 512 },
  { name: "icon_512x512@2x.png", size: 1024 },
];

function render(svg: Buffer, size: number): Buffer {
  const resvg = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    fitTo: { mode: "width", value: size },
  });

  return resvg.render().asPng();
}

const svg = readFileSync(SVG);

rmSync(ICONSET, { recursive: true, force: true });
mkdirSync(ICONSET, { recursive: true });

for (const { name, size } of SIZES) {
  writeFileSync(join(ICONSET, name), render(svg, size));
  log(`wrote ${name} (${size}px)`);
}

copyFileSync(join(ICONSET, "icon_512x512@2x.png"), join(BUILD, "icon.png"));

execFileSync(
  "iconutil",
  ["-c", "icns", ICONSET, "-o", join(BUILD, "icon.icns")],
  {
    stdio: "inherit",
  },
);

log("Icon generation complete.");
