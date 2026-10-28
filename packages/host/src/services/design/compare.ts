/**
 * A Figma frame against what a device shows, pixel for pixel. The frame is
 * rendered at the device's own pixel width so the two line up without
 * resampling; heights rarely match (scrolling, safe areas), so both are cut to
 * the shorter one.
 */

import type { DesignComparison } from "@argus/remote-protocol";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { parseFigmaUrl } from "../integrations/figma/refs";
import { figmaFrame, withFigma } from "../integrations/figma/service";
import { capture } from "../telemetry/telemetry";

/** Per-pixel colour distance (0–1) below which pixels count as the same. */
const PIXEL_THRESHOLD = 0.12;

function crop(png: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, 0, 0, width, height, 0, 0);

  return out;
}

/** Diff two same-width PNGs over their shared height. */
export function diffImages(
  design: Buffer,
  screenshot: Buffer,
): Omit<DesignComparison, "design" | "screenshot"> & {
  designPng: Buffer;
  screenshotPng: Buffer;
} {
  const a = PNG.sync.read(design);
  const b = PNG.sync.read(screenshot);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const left = crop(a, width, height);
  const right = crop(b, width, height);
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

/** Throws a sentence when the link isn't a frame Argus can render. */
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
  const shotWidth = PNG.sync.read(screenshot).width;
  const scale = Math.min(4, Math.max(0.01, shotWidth / preview.width));
  const rendered = await withFigma((api) =>
    api.frame(ref.fileKey, ref.nodeId, scale),
  );
  if (!rendered) {
    throw "Figma didn't render that frame.";
  }
  const result = diffImages(Buffer.from(rendered.image, "base64"), screenshot);
  capture("design_compared", {
    diff_bucket: matchBucket(result.differingFraction),
    source,
  });

  return {
    differingFraction: result.differingFraction,
    width: result.width,
    height: result.height,
    diff: result.diff,
    design: result.designPng.toString("base64"),
    screenshot: result.screenshotPng.toString("base64"),
  };
}
