/**
 * A Figma frame against what a device shows, pixel for pixel. A whole screen
 * is rendered at the device's pixel width and diffed from the top; a single
 * component is rendered at the device's pixel ratio and found on the
 * screenshot first, so only the rectangle it occupies is diffed.
 */

import type { DesignComparison, DesignMatch } from "@argus/remote-protocol";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { parseFigmaUrl } from "../integrations/figma/refs";
import { figmaFrame, withFigma } from "../integrations/figma/service";
import { capture } from "../telemetry/telemetry";
import { Haystack, resample, toGray } from "./locate";

/** Per-pixel colour distance (0–1) below which pixels count as the same. */
const PIXEL_THRESHOLD = 0.12;
/** Correlation below which a component counts as not on screen. */
export const MATCH_THRESHOLD = 0.5;
/** A frame this tall at full width (share of the screenshot) is a whole screen. */
const SCREEN_HEIGHT_SHARE = 0.8;
/** A candidate scale this well matched ends the search. */
const SURE = 0.97;
/** Device pixel ratios tried when the frame is a component. */
const PIXEL_RATIOS = [3, 2, 1];

function crop(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
): PNG {
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, x, y, width, height, 0, 0);

  return out;
}

type Diffed = Omit<DesignComparison, "design" | "match" | "screenshot"> & {
  designPng: Buffer;
  screenshotPng: Buffer;
};

function diffPngs(a: PNG, b: PNG, at = { x: 0, y: 0 }): Diffed {
  const width = Math.min(a.width, b.width - at.x);
  const height = Math.min(a.height, b.height - at.y);
  const left = crop(a, 0, 0, width, height);
  const right = crop(b, at.x, at.y, width, height);
  const diff = new PNG({ width, height });
  const differing = pixelmatch(
    left.data,
    right.data,
    diff.data,
    width,
    height,
    {
      threshold: PIXEL_THRESHOLD,
      alpha: 0.2,
    },
  );

  return {
    differingFraction: differing / (width * height),
    width,
    height,
    diff: PNG.sync.write(diff).toString("base64"),
    designPng: PNG.sync.write(left),
    screenshotPng: PNG.sync.write(right),
  };
}

/** Diff two PNGs from their top-left corners over their shared size. */
export function diffImages(design: Buffer, screenshot: Buffer): Diffed {
  return diffPngs(PNG.sync.read(design), PNG.sync.read(screenshot));
}

/** Renders the frame at a scale; null when Figma returns nothing. */
export type FrameRenderer = (scale: number) => Promise<Buffer | null>;

function rendered(png: Buffer | null): PNG {
  if (!png) {
    throw "Figma didn't render that frame.";
  }

  return PNG.sync.read(png);
}

/**
 * Renders a `frameWidth`×`frameHeight` (pt) frame and diffs it against a
 * screenshot. Frames that fill the screen width and most of its height are
 * diffed from the top as before; anything smaller is located first.
 */
export async function compareFrame(
  render: FrameRenderer,
  frameWidth: number,
  frameHeight: number,
  screenshot: Buffer,
): Promise<DesignComparison> {
  const shot = PNG.sync.read(screenshot);
  const fullWidth = Math.min(4, Math.max(0.01, shot.width / frameWidth));
  if (frameHeight * fullWidth >= shot.height * SCREEN_HEIGHT_SHARE) {
    const design = rendered(await render(fullWidth));
    const result = diffPngs(design, shot);
    const shared = toGray(crop(design, 0, 0, result.width, result.height));
    const confidence = new Haystack(toGray(shot)).scoreAt(shared, 0, 0);

    return finish(result, {
      x: 0,
      y: 0,
      width: result.width,
      height: result.height,
      scale: fullWidth,
      confidence,
      found: true,
      component: false,
    });
  }

  const nearRatio = PIXEL_RATIOS.some(
    (r) => Math.abs(fullWidth / r - 1) < 0.02,
  );
  const scales = [...PIXEL_RATIOS, ...(nearRatio ? [] : [fullWidth])].filter(
    (s) =>
      s <= 4 &&
      Math.round(frameWidth * s) <= shot.width &&
      Math.round(frameHeight * s) <= shot.height,
  );
  if (scales.length === 0) {
    throw "That frame is bigger than the device's screen.";
  }
  // One render at the largest ratio, area-resampled for the others; only the winner is re-rendered.
  const top = Math.max(...scales);
  const base = rendered(await render(top));
  const baseGray = toGray(base);
  const haystack = new Haystack(toGray(shot));
  let best: { scale: number; x: number; y: number; confidence: number } | null =
    null;
  for (const scale of scales) {
    const tpl =
      scale === top
        ? baseGray
        : resample(
            baseGray,
            Math.max(1, Math.round((base.width * scale) / top)),
            Math.max(1, Math.round((base.height * scale) / top)),
          );
    const hit = haystack.locate(tpl);
    if (hit && (!best || hit.confidence > best.confidence)) {
      best = { scale, ...hit };
    }
    if (best && best.confidence >= SURE) {
      break;
    }
  }
  if (!best) {
    throw "That frame is bigger than the device's screen.";
  }
  let design = base;
  if (best.scale !== top) {
    const exact = rendered(await render(best.scale));
    const hit = haystack.locate(toGray(exact));
    if (hit) {
      design = exact;
      best = { scale: best.scale, ...hit };
    }
  }
  const result = diffPngs(design, shot, best);

  return finish(result, {
    x: best.x,
    y: best.y,
    width: result.width,
    height: result.height,
    scale: best.scale,
    confidence: best.confidence,
    found: best.confidence >= MATCH_THRESHOLD,
    component: true,
  });
}

function finish(result: Diffed, match: DesignMatch): DesignComparison {
  return {
    differingFraction: result.differingFraction,
    width: result.width,
    height: result.height,
    diff: result.diff,
    design: result.designPng.toString("base64"),
    screenshot: result.screenshotPng.toString("base64"),
    match: { ...match, confidence: Math.round(match.confidence * 1000) / 1000 },
  };
}

/** The whole screenshot with the matched rectangle outlined, base64 PNG. */
export function outlineMatch(screenshot: Buffer, match: DesignMatch): string {
  const png = PNG.sync.read(screenshot);
  const stroke = Math.max(2, Math.round(match.scale * 1.5));
  const paint = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < png.width && y < png.height) {
      png.data.set([255, 45, 85, 255], (y * png.width + x) * 4);
    }
  };
  for (let s = 0; s < stroke; s++) {
    for (let x = match.x - stroke; x < match.x + match.width + stroke; x++) {
      paint(x, match.y - 1 - s);
      paint(x, match.y + match.height + s);
    }
    for (let y = match.y - stroke; y < match.y + match.height + stroke; y++) {
      paint(match.x - 1 - s, y);
      paint(match.x + match.width + s, y);
    }
  }

  return PNG.sync.write(png).toString("base64");
}

/** "at 72,900 (1029×300 px), confidence 0.93" */
export function describeMatch(match: DesignMatch): string {
  return `at ${match.x},${match.y} (${match.width}×${match.height} px, ${Number(match.scale.toFixed(2))}×), confidence ${match.confidence.toFixed(2)}`;
}

function matchBucket(fraction: number): "<2%" | "<10%" | "<30%" | ">=30%" {
  if (fraction < 0.02) {
    return "<2%";
  }
  if (fraction < 0.1) {
    return "<10%";
  }

  return fraction < 0.3 ? "<30%" : ">=30%";
}

export async function compareToDesign(
  url: string,
  screenshot: Buffer,
  source: "agent" | "app",
): Promise<DesignComparison> {
  const ref = parseFigmaUrl(url);
  const preview = ref ? await figmaFrame(url) : null;
  if (!ref || !preview || preview.width <= 0) {
    throw `"${url}" isn't a Figma frame Argus can render.`;
  }
  const result = await compareFrame(
    async (scale) => {
      const frame = await withFigma((api) =>
        api.frame(ref.fileKey, ref.nodeId, scale),
      );

      return frame ? Buffer.from(frame.image, "base64") : null;
    },
    preview.width,
    preview.height,
    screenshot,
  );
  capture("design_compared", {
    diff_bucket: matchBucket(result.differingFraction),
    mode: result.match?.component ? "component" : "screen",
    matched: result.match?.found ?? true,
    source,
  });

  return result;
}
