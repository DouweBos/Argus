/**
 * Rasterize every `build/menu-icons/*.svg` into the `<name>Template.png` and
 * `<name>Template@2x.png` PNGs that Electron's `nativeImage.setTemplateImage`
 * expects. Run after editing or adding an SVG — the PNGs are checked in so the
 * packaged app doesn't need a rasterizer at runtime.
 *
 * `Template` suffix tells macOS the image is monochrome and should be tinted
 * for light/dark menu bars. The SVGs use `stroke="black"` for that reason.
 */
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { error, log } from "../app/lib/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "build", "menu-icons");

function render(svg: Buffer, size: number): Buffer {
  const resvg = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    fitTo: { mode: "width", value: size },
  });

  return resvg.render().asPng();
}

const svgs = readdirSync(iconsDir).filter((f) => extname(f) === ".svg");
if (svgs.length === 0) {
  error(`No SVGs found in ${iconsDir}`);
  process.exit(1);
}

for (const file of svgs) {
  const name = basename(file, ".svg");
  const svg = readFileSync(join(iconsDir, file));
  const png1x = render(svg, 16);
  const png2x = render(svg, 32);
  writeFileSync(join(iconsDir, `${name}Template.png`), png1x);
  writeFileSync(join(iconsDir, `${name}Template@2x.png`), png2x);
  log(`rasterized ${file} → ${name}Template.png + @2x`);
}
