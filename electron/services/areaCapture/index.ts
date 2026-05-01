/**
 * Area screen capture.
 *
 * The launcher itself is a fullscreen transparent window with a 20%-black
 * backdrop and a centered card. The renderer detects drags on the backdrop,
 * sends the rect (in CSS / DIP units, relative to the launcher window) here,
 * and we:
 *
 *   1. Hide the launcher window for ~80ms so neither the dim layer nor the
 *      card appears in the captured frame.
 *   2. Sample the display via `desktopCapturer.getSources` and crop down to
 *      the requested rectangle.
 *   3. Re-show the launcher and broadcast the cropped PNG back to the
 *      renderer as `area-capture:attached`, where the launcher form appends
 *      it to the pending images strip.
 *
 * `desktopCapturer` requires the macOS Screen Recording permission. The
 * first call surfaces the system prompt; subsequent calls work silently.
 */

import {
  desktopCapturer,
  ipcMain,
  screen,
  systemPreferences,
  type Display,
} from "electron";
import { createLogger } from "../../../app/lib/logger";
import { broadcastToRenderers } from "../../broadcast";
import { hideLauncherWindowOnly, showLauncher } from "../launcher";

const log = createLogger("areaCapture");

interface AreaRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface CaptureResult {
  data: string;
  media_type: string;
}

let registered = false;
let inFlight = false;

export function registerAreaCaptureHandlers(): void {
  if (registered) {
    return;
  }
  registered = true;

  ipcMain.handle(
    "area_capture_complete",
    async (
      _e,
      args: { displayId?: number | string; rect?: AreaRect | null },
    ) => {
      if (!args?.rect || !args.displayId) {
        return;
      }
      if (inFlight) {
        return;
      }
      const display = screen
        .getAllDisplays()
        .find((d) => String(d.id) === String(args.displayId));
      if (!display) {
        return;
      }

      inFlight = true;
      try {
        // On macOS the very first capture attempt surfaces the Screen
        // Recording permission prompt. If we hide → sample → re-show in that
        // case, the launcher pops back in front of the system dialog. So
        // when permission isn't granted yet, trigger the prompt without
        // touching the launcher window and bail; the user grants, retries,
        // and the next call follows the normal path.
        if (
          process.platform === "darwin" &&
          systemPreferences.getMediaAccessStatus("screen") !== "granted"
        ) {
          // Fire-and-forget: this is what surfaces the system prompt.
          desktopCapturer
            .getSources({
              types: ["screen"],
              thumbnailSize: { width: 1, height: 1 },
            })
            .catch(() => {
              // ignore — permission prompt is the side effect we wanted
            });
          hideLauncherWindowOnly();

          return;
        }

        hideLauncherWindowOnly();
        // Compositor needs a beat to actually drop the launcher from the
        // frame before we sample.
        await new Promise((r) => setTimeout(r, 80));
        const cropped = await captureRect(display, args.rect);
        showLauncher();
        if (cropped) {
          broadcastToRenderers("area-capture:attached", cropped);
        }
      } catch (err) {
        log.error("captureRect failed:", err);
        showLauncher();
      } finally {
        inFlight = false;
      }
    },
  );
}

async function captureRect(
  display: Display,
  rect: AreaRect,
): Promise<CaptureResult | null> {
  const scaleFactor = display.scaleFactor || 1;
  const physicalWidth = Math.round(display.size.width * scaleFactor);
  const physicalHeight = Math.round(display.size.height * scaleFactor);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: physicalWidth, height: physicalHeight },
  });

  const match =
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!match) {
    throw new Error("No screen source available");
  }

  const physicalRect = {
    x: Math.max(0, Math.round(rect.x * scaleFactor)),
    y: Math.max(0, Math.round(rect.y * scaleFactor)),
    width: Math.max(1, Math.round(rect.width * scaleFactor)),
    height: Math.max(1, Math.round(rect.height * scaleFactor)),
  };

  const tSize = match.thumbnail.getSize();
  physicalRect.x = Math.min(physicalRect.x, Math.max(0, tSize.width - 1));
  physicalRect.y = Math.min(physicalRect.y, Math.max(0, tSize.height - 1));
  physicalRect.width = Math.min(
    physicalRect.width,
    tSize.width - physicalRect.x,
  );
  physicalRect.height = Math.min(
    physicalRect.height,
    tSize.height - physicalRect.y,
  );
  if (physicalRect.width <= 0 || physicalRect.height <= 0) {
    return null;
  }

  const cropped = match.thumbnail.crop(physicalRect);
  if (cropped.isEmpty()) {
    return null;
  }
  const png = cropped.toPNG();

  return {
    data: png.toString("base64"),
    media_type: "image/png",
  };
}

export type { AreaRect };
