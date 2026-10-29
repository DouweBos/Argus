import { PNG } from "pngjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareFrame,
  compareToDesign,
  diffImages,
  outlineMatch,
} from "./compare";

const figma = vi.hoisted(() => ({
  frame: vi.fn(),
  render: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("../integrations/figma/service", () => ({
  figmaFrame: figma.frame,
  withFigma: (fn: (api: unknown) => unknown) =>
    fn({
      frame: (_file: string, _node: string, scale: number) =>
        figma.render(scale),
    }),
}));
vi.mock("../telemetry/telemetry", () => ({ capture: figma.capture }));

function solid(
  width: number,
  height: number,
  rgb: [number, number, number],
): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data.set([...rgb, 255], i * 4);
  }

  return PNG.sync.write(png);
}

/** Deterministic 4pt colour blocks, drawn at `scale` pixels per point. */
function blocks(
  widthPt: number,
  heightPt: number,
  seed: number,
  scale: number,
): PNG {
  const png = new PNG({
    width: Math.round(widthPt * scale),
    height: Math.round(heightPt * scale),
  });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const bx = Math.floor(x / scale / 4);
      const by = Math.floor(y / scale / 4);
      const h =
        Math.imul(
          (bx * 73856093) ^ (by * 19349663) ^ (seed * 83492791),
          2654435761,
        ) >>> 0;
      png.data.set(
        [h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff, 255],
        (y * png.width + x) * 4,
      );
    }
  }

  return png;
}

/** A 390×844pt screen at `scale`, with `card` pasted at a point offset. */
function screen(
  scale: number,
  card?: { png: PNG; xPt: number; yPt: number },
): Buffer {
  const shot = blocks(390, 844, 7, scale);
  if (card) {
    PNG.bitblt(
      card.png,
      shot,
      0,
      0,
      card.png.width,
      card.png.height,
      card.xPt * scale,
      card.yPt * scale,
    );
  }

  return PNG.sync.write(shot);
}

const renderCard =
  (seed: number, w = 100, h = 40) =>
  (scale: number) =>
    Promise.resolve(PNG.sync.write(blocks(w, h, seed, scale)));

describe("diffImages", () => {
  it("scores identical images as matching", () => {
    const img = solid(10, 10, [255, 255, 255]);
    expect(diffImages(img, img).differingFraction).toBe(0);
  });

  it("compares over the shared height only", () => {
    const top = solid(10, 20, [255, 255, 255]);
    const result = diffImages(top, solid(10, 10, [255, 255, 255]));
    expect([result.width, result.height]).toEqual([10, 10]);
    expect(result.differingFraction).toBe(0);
  });

  it("counts clearly different pixels", () => {
    const result = diffImages(
      solid(4, 4, [255, 255, 255]),
      solid(4, 4, [0, 0, 0]),
    );
    expect(result.differingFraction).toBe(1);
    expect(PNG.sync.read(Buffer.from(result.diff, "base64")).width).toBe(4);
  });
});

describe("compareFrame", () => {
  it.each([2, 3])(
    "finds a component pasted at an offset on a %d× screen",
    async (scale) => {
      const shot = screen(scale, {
        png: blocks(100, 40, 1, scale),
        xPt: 24,
        yPt: 300,
      });
      const started = performance.now();
      const result = await compareFrame(renderCard(1), 100, 40, shot);
      const elapsed = performance.now() - started;
      expect(result.match).toMatchObject({
        x: 24 * scale,
        y: 300 * scale,
        width: 100 * scale,
        height: 40 * scale,
        scale,
        found: true,
        component: true,
      });
      expect(result.match?.confidence).toBeGreaterThan(0.95);
      expect(result.differingFraction).toBe(0);
      expect([result.width, result.height]).toEqual([100 * scale, 40 * scale]);
      expect(elapsed).toBeLessThan(2000);
    },
  );

  it("finds a full-width banner below the top", async () => {
    const shot = screen(3, { png: blocks(390, 60, 2, 3), xPt: 0, yPt: 400 });
    const result = await compareFrame(renderCard(2, 390, 60), 390, 60, shot);
    expect(result.match).toMatchObject({
      x: 0,
      y: 1200,
      scale: 3,
      found: true,
    });
    expect(result.differingFraction).toBe(0);
  });

  it("diffs a whole screen from the top at full width, as before", async () => {
    const shot = screen(3);
    const render = vi.fn(renderCard(7, 390, 844));
    const result = await compareFrame(render, 390, 844, shot);
    expect(render).toHaveBeenCalledWith(3);
    expect(result.match).toMatchObject({
      x: 0,
      y: 0,
      scale: 3,
      found: true,
      component: false,
    });
    expect(result.differingFraction).toBe(0);
    const before = diffImages(PNG.sync.write(blocks(390, 844, 7, 3)), shot);
    expect([result.width, result.height, result.diff]).toEqual([
      before.width,
      before.height,
      before.diff,
    ]);
  });

  it("says a component isn't on screen rather than diffing a random spot", async () => {
    const result = await compareFrame(renderCard(3), 100, 40, screen(3));
    expect(result.match?.found).toBe(false);
    expect(result.match?.confidence).toBeLessThan(0.5);
  });

  it("outlines the match on the whole screenshot", async () => {
    const shot = screen(2, { png: blocks(100, 40, 1, 2), xPt: 24, yPt: 300 });
    const result = await compareFrame(renderCard(1), 100, 40, shot);
    const outlined = PNG.sync.read(
      Buffer.from(outlineMatch(shot, result.match!), "base64"),
    );
    const at = ((600 - 1) * outlined.width + 48) * 4;
    expect([...outlined.data.subarray(at, at + 4)]).toEqual([255, 45, 85, 255]);
  });
});

describe("compareToDesign", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a component at the device's pixel ratio and reports the mode", async () => {
    figma.frame.mockResolvedValue({
      name: "Card",
      image: "",
      width: 100,
      height: 40,
    });
    figma.render.mockImplementation(async (scale: number) => ({
      name: "Card",
      image: (await renderCard(1)(scale)).toString("base64"),
      width: 100,
      height: 40,
    }));
    const shot = screen(2, { png: blocks(100, 40, 1, 2), xPt: 24, yPt: 300 });
    const result = await compareToDesign(
      "https://www.figma.com/design/abc123/App?node-id=1-2",
      shot,
      "agent",
    );
    expect(result.match).toMatchObject({
      x: 48,
      y: 600,
      scale: 2,
      found: true,
    });
    expect(figma.render).toHaveBeenLastCalledWith(2);
    expect(figma.capture).toHaveBeenCalledWith("design_compared", {
      diff_bucket: "<2%",
      matched: true,
      mode: "component",
      source: "agent",
    });
  });
});
