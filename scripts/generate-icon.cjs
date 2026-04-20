/* eslint-disable */
// Rasterizes build/icon.svg into an iconset, then builds icon.icns/icon.png.
// Run with: pnpm exec electron scripts/generate-icon.cjs
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const SVG = path.join(BUILD, "icon.svg");
const ICONSET = path.join(BUILD, "icon.iconset");

const SIZES = [
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

async function renderAt(win, size) {
  await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('svg'); el.setAttribute('width', '${size}'); el.setAttribute('height', '${size}'); document.body.style.width='${size}px'; document.body.style.height='${size}px'; })();`,
  );
  win.setContentSize(size, size);
  await new Promise((r) => setTimeout(r, 80));
  const image = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: size,
    height: size,
  });
  return image.toPNG();
}

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(SVG, "utf8");
    fs.rmSync(ICONSET, { recursive: true, force: true });
    fs.mkdirSync(ICONSET, { recursive: true });

    const tmpHtml = path.join(os.tmpdir(), `argus-icon-${Date.now()}.html`);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent;}
      body{width:1024px;height:1024px;}
      svg{display:block;}
    </style></head><body>${svg}</body></html>`;
    fs.writeFileSync(tmpHtml, html);

    const win = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      transparent: true,
      frame: false,
      backgroundColor: "#00000000",
      webPreferences: { offscreen: false },
    });
    await win.loadFile(tmpHtml);
    await new Promise((r) => setTimeout(r, 120));

    for (const { name, size } of SIZES) {
      const buf = await renderAt(win, size);
      fs.writeFileSync(path.join(ICONSET, name), buf);
      console.log("wrote", name, size);
    }

    win.destroy();
    fs.rmSync(tmpHtml, { force: true });

    fs.copyFileSync(
      path.join(ICONSET, "icon_512x512@2x.png"),
      path.join(BUILD, "icon.png"),
    );

    execFileSync(
      "iconutil",
      ["-c", "icns", ICONSET, "-o", path.join(BUILD, "icon.icns")],
      { stdio: "inherit" },
    );

    console.log("Icon generation complete.");
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
