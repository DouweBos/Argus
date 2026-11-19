// Regenerates :ui's file-type icons (res/drawable/fileicon_*.xml) from ArgusUI's FileIcons.xcassets,
// converting the few SVG features the set uses. Run from clients/android: node scripts/gen-file-icons.mjs
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ASSETS = "../apple/ArgusUI/Sources/ArgusUI/Resources";
const OUT = "ui/src/main/res/drawable";

for (const set of readdirSync(join(ASSETS, "FileIcons.xcassets")).filter((d) => d.endsWith(".imageset"))) {
  const name = set.replace(".imageset", "").replaceAll("-", "_");
  const svgs = readdirSync(join(ASSETS, "FileIcons.xcassets", set)).filter((f) => f.endsWith(".svg"));
  // A `_light` file is the default appearance; its plain twin is the dark one.
  const light = svgs.find((f) => f.endsWith("_light.svg"));
  for (const svg of svgs) {
    const out = light && svg !== light ? `fileicon_${name}_dark.xml` : `fileicon_${name}.xml`;
    writeFileSync(join(OUT, out), convert(join(ASSETS, "FileIcons.xcassets", set, svg)));
  }
}
copyFileSync(join(ASSETS, "FileIcons.json"), "ui/src/main/assets/FileIcons.json");

function convert(input) {
const src = readFileSync(input, "utf8");

const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z0-9:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

// Tokenise into open/close/self-closing tags.
const tokens = [...src.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)].map((m) => ({
  close: m[1] === "/",
  name: m[2],
  attrs: attrs(m[3]),
  self: m[4] === "/",
}));

// Build a tree.
const root = { name: "root", attrs: {}, children: [] };
const stack = [root];
for (const t of tokens) {
  if (t.close) {
    stack.pop();
    continue;
  }
  const node = { name: t.name, attrs: t.attrs, children: [] };
  stack.at(-1).children.push(node);
  if (!t.self) stack.push(node);
}
const svg = root.children.find((n) => n.name === "svg");
const ids = {};
const index = (n) => {
  if (n.attrs.id) ids[n.attrs.id] = n;
  n.children.forEach(index);
};
index(svg);

const [vx, vy, vw, vh] = (svg.attrs.viewBox ?? `0 0 ${svg.attrs.width} ${svg.attrs.height}`)
  .trim()
  .split(/[\s,]+/)
  .map(Number);

const num = (v) => +(+v).toFixed(4);
const circlePath = (cx, cy, r) =>
  `M${num(cx - r)},${num(cy)}a${r},${r} 0 1,0 ${num(2 * r)},0a${r},${r} 0 1,0 ${num(-2 * r)},0z`;
const rectPath = (x, y, w, h, rx) => {
  if (!rx) return `M${x},${y}h${w}v${h}h${-w}z`;
  rx = Math.min(rx, w / 2, h / 2);
  return (
    `M${x + rx},${y}h${w - 2 * rx}a${rx},${rx} 0 0 1 ${rx},${rx}v${h - 2 * rx}` +
    `a${rx},${rx} 0 0 1 ${-rx},${rx}h${-(w - 2 * rx)}a${rx},${rx} 0 0 1 ${-rx},${-rx}` +
    `v${-(h - 2 * rx)}a${rx},${rx} 0 0 1 ${rx},${-rx}z`
  );
};

const colour = (c) => {
  if (!c) return "#FF000000";
  c = c.trim();
  if (/^#[0-9a-f]{3}$/i.test(c)) c = "#" + [...c.slice(1)].map((x) => x + x).join("");
  if (c === "white") return "#FFFFFFFF";
  if (c === "black") return "#FF000000";
  return c.toUpperCase();
};

function gradientXml(id) {
  const g = ids[id];
  let { x1, y1, x2, y2 } = Object.fromEntries(["x1", "y1", "x2", "y2"].map((k) => [k, +g.attrs[k]]));
  const t = g.attrs.gradientTransform;
  if (t) {
    const tr = /translate\(([^)]*)\)/.exec(t)?.[1].split(/[\s,]+/).map(Number) ?? [0, 0];
    const sc = /scale\(([^)]*)\)/.exec(t)?.[1].split(/[\s,]+/).map(Number) ?? [1];
    const sx = sc[0];
    const sy = sc[1] ?? sc[0];
    // translate(...)scale(...): p' = T + S*p
    [x1, x2] = [x1, x2].map((x) => tr[0] + sx * x);
    [y1, y2] = [y1, y2].map((y) => (tr[1] ?? 0) + sy * y);
  }
  const stops = g.children
    .filter((c) => c.name === "stop")
    .map((s) => `        <item android:offset="${num(s.attrs.offset)}" android:color="${colour(s.attrs["stop-color"])}"/>`)
    .join("\n");
  return (
    `\n    <aapt:attr name="android:fillColor">\n      <gradient android:type="linear" android:startX="${num(x1)}" android:startY="${num(y1)}" android:endX="${num(x2)}" android:endY="${num(y2)}">\n${stops}\n      </gradient>\n    </aapt:attr>\n  `
  );
}

let usesAapt = false;
const out = [];
function emit(n, inherited) {
  const a = { ...inherited, ...n.attrs };
  if (n.name === "defs" || n.name === "linearGradient") return;
  if (n.name === "g" || n.name === "svg") {
    const childInherited = { fill: a.fill, "fill-rule": a["fill-rule"], "clip-rule": a["clip-rule"] };
    n.children.forEach((c) => emit(c, childInherited));
    return;
  }
  if (n.name === "use") {
    const ref = (a["xlink:href"] ?? a.href).slice(1);
    const { ["xlink:href"]: _, href: __, id: ___, ...rest } = a;
    emit(ids[ref], rest);
    return;
  }
  let d;
  if (n.name === "path") d = a.d;
  else if (n.name === "circle") d = circlePath(+a.cx, +a.cy, +a.r);
  else if (n.name === "rect") d = rectPath(+(a.x ?? 0), +(a.y ?? 0), +a.width, +a.height, +(a.rx ?? a.ry ?? 0));
  else throw new Error(`unsupported <${n.name}> in ${input}`);
  // An element's own fill wins over the inherited one.
  const fill = n.attrs.fill ?? inherited.fill;
  if (fill === "none") return;
  const evenOdd = (a["fill-rule"] ?? a["clip-rule"]) === "evenodd";
  const grad = fill?.startsWith("url(");
  if (grad) usesAapt = true;
  const opacity = a.opacity ?? a["fill-opacity"];
  out.push(
    `  <path\n    android:pathData="${d.replace(/\s+/g, " ").trim()}"` +
      (grad ? "" : `\n    android:fillColor="${colour(fill)}"`) +
      (opacity ? `\n    android:fillAlpha="${opacity}"` : "") +
      (evenOdd ? `\n    android:fillType="evenOdd"` : "") +
      (grad ? `>${gradientXml(/url\(#([^)]+)\)/.exec(fill)[1])}</path>` : "/>"),
  );
}
emit(svg, {});

const body = vx || vy ? `<group android:translateX="${-vx}" android:translateY="${-vy}">\n${out.join("\n")}\n</group>` : out.join("\n");
const xml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"${usesAapt ? '\n    xmlns:aapt="http://schemas.android.com/aapt"' : ""}
    android:width="16dp"
    android:height="16dp"
    android:viewportWidth="${vw}"
    android:viewportHeight="${vh}">
${body}
</vector>
`;
return xml;
}
