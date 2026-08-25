/**
 * Render the Argus mark (same artwork as `build/icon.svg`) into the app icons
 * the Expo remote client needs: full-bleed square, Android adaptive
 * foreground/background, and an Android 13 themed monochrome layer.
 *
 * Run with: pnpm build:mobile-icon
 */
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../app/lib/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "clients", "argus-remote", "assets");

const SIZE = 1024;
const ACCENT = "#f5a623";

/** Artwork was authored inside the desktop icon's 824px squircle. */
const AUTHORED = 824;

/**
 * Rings, dot and glow, drawn around the canvas centre at the given scale.
 * `stroke` overrides the accent so the monochrome layer can go solid white.
 */
function mark(scale: number, stroke = ACCENT, withGlow = true): string {
  const c = SIZE / 2;
  const s = (n: number) => n * scale;

  return `
    ${withGlow ? `<circle cx="${c}" cy="${c}" r="${s(378)}" fill="url(#glow)" />` : ""}
    <circle cx="${c}" cy="${c}" r="${s(274)}" fill="none" stroke="${stroke}" stroke-width="${s(6.8)}" stroke-dasharray="${s(20)} ${s(35)}" opacity="0.6" />
    <circle cx="${c}" cy="${c}" r="${s(151)}" fill="none" stroke="${stroke}" stroke-width="${s(10.5)}" />
    <circle cx="${c}" cy="${c}" r="${s(41)}" fill="${stroke}" />`;
}

const BACKDROP = `
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3a2410" />
      <stop offset="55%" stop-color="#120e0c" />
      <stop offset="100%" stop-color="#08070a" />
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.35" />
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0" />
    </radialGradient>
  </defs>`;

function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${BACKDROP}${body}</svg>`;
}

const FULL_BLEED = SIZE / AUTHORED;
/** Android masks to the inner 66%, so the adaptive layers sit inside that. */
const SAFE = (SIZE * 0.66) / AUTHORED;

const ICONS: { body: string; name: string }[] = [
  {
    name: "icon.png",
    body: svg(
      `<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)" />${mark(FULL_BLEED)}`,
    ),
  },
  { name: "adaptive-icon.png", body: svg(mark(SAFE)) },
  {
    name: "adaptive-icon-background.png",
    body: svg(`<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)" />`),
  },
  {
    name: "monochrome-icon.png",
    body: svg(mark(SAFE, "#ffffff", false)),
  },
];

mkdirSync(ASSETS, { recursive: true });

for (const { body, name } of ICONS) {
  const png = new Resvg(body, {
    background: "rgba(0,0,0,0)",
    fitTo: { mode: "width", value: SIZE },
  })
    .render()
    .asPng();

  writeFileSync(join(ASSETS, name), png);
  log(`wrote ${name} (${SIZE}px)`);
}

log("Mobile icon generation complete.");
