/**
 * The browser's element picker: hit-tests the page at a point and describes
 * what's there, over the screencast's CDP connection. Conductor forwards no
 * mouse moves, so the Mac drives the hover itself rather than CDP's inspect mode.
 */

import type { BrowserElement, BrowserElementHit } from "@argus/remote-protocol";
import { cdpCall } from "./cdpScreencast";
import { DESCRIBE_AT } from "./pageScript";

async function evaluateAt(
  sessionId: string,
  x: number,
  y: number,
  full: boolean,
): Promise<unknown> {
  const reply = await cdpCall(sessionId, "Runtime.evaluate", {
    expression: `${DESCRIBE_AT}(${x}, ${y}, ${full})`,
    returnByValue: true,
  });
  const result = reply.result as { value?: unknown } | undefined;

  return result?.value ?? null;
}

const clampUnit = (n: number): number => Math.min(1, Math.max(0, n));

export async function browserElementAt(
  sessionId: string,
  x: number,
  y: number,
): Promise<BrowserElementHit | null> {
  const hit = await evaluateAt(sessionId, clampUnit(x), clampUnit(y), false);

  return (hit as BrowserElementHit | null) ?? null;
}

/** Padding around the crop, in CSS pixels, so the element reads in context. */
const CROP_PAD = 8;

export async function browserPickElement(
  sessionId: string,
  x: number,
  y: number,
): Promise<BrowserElement | null> {
  const picked = (await evaluateAt(
    sessionId,
    clampUnit(x),
    clampUnit(y),
    true,
  )) as (BrowserElement & { scroll: { x: number; y: number } }) | null;
  if (!picked) {
    return null;
  }
  const { scroll, ...element } = picked;
  const clip = cropRect(element);
  if (clip) {
    try {
      const shot = await cdpCall(sessionId, "Page.captureScreenshot", {
        format: "png",
        clip: { ...clip, x: clip.x + scroll.x, y: clip.y + scroll.y, scale: 1 },
      });
      if (typeof shot.data === "string") {
        element.screenshot = shot.data;
      }
    } catch {
      // The context still goes out without a picture.
    }
  }

  return element;
}

/** The element's bounds, padded and clipped to the viewport; null off screen. */
export function cropRect(
  hit: BrowserElementHit,
): { x: number; y: number; width: number; height: number } | null {
  const { bounds, viewport } = hit;
  const left = Math.max(0, bounds.x - CROP_PAD);
  const top = Math.max(0, bounds.y - CROP_PAD);
  const right = Math.min(viewport.width, bounds.x + bounds.width + CROP_PAD);
  const bottom = Math.min(viewport.height, bounds.y + bounds.height + CROP_PAD);
  if (right - left < 1 || bottom - top < 1) {
    return null;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}
