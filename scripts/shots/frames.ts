/**
 * Frames out of the running app: settle, shoot until two shots agree, and
 * stitch a recording's beats into an mp4.
 */

import type { Crop } from "./scenes";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { sleep } from "./devDriver";
import { WINDOW, captureWindow } from "./macApp";

const run = promisify(execFile);

/**
 * A capture at the window's full 2x size. WindowServer occasionally hands back
 * a scaled-down image of a window it is reordering; that one is retaken.
 */
async function fullCapture(windowNumber: number, out: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    await captureWindow(windowNumber, out);
    const { width, height } = await pixelSize(out);
    if (width === WINDOW.width * 2 && height === WINDOW.height * 2) {
      return;
    }
    if (attempt >= 10) {
      throw new Error(
        `window ${windowNumber} keeps capturing at ${width}x${height}`,
      );
    }
    await sleep(500);
  }
}

/**
 * Shoot until two consecutive captures are byte-identical: SwiftUI settles a
 * layout over several passes, and a spinner never does — after `tries` the
 * last one is taken rather than failing a run over a progress ring.
 */
export async function stableCapture(
  windowNumber: number,
  out: string,
  tries = 10,
): Promise<boolean> {
  const previous = `${out}.prev.png`;
  await sleep(700);
  await fullCapture(windowNumber, previous);
  for (let i = 0; i < tries; i += 1) {
    await sleep(400);
    await fullCapture(windowNumber, out);
    if (fs.readFileSync(out).equals(fs.readFileSync(previous))) {
      fs.rmSync(previous, { force: true });

      return true;
    }
    fs.renameSync(out, previous);
  }
  fs.renameSync(previous, out);

  return false;
}

export async function crop(
  source: string,
  area: Crop,
  out: string,
): Promise<void> {
  // ffmpeg rather than sips: sips centres a crop whose offset is 0.
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    source,
    "-vf",
    `crop=${area.w}:${area.h}:${area.x}:${area.y}`,
    `${out}.tmp.png`,
  ]);
  fs.renameSync(`${out}.tmp.png`, out);
}

/**
 * Behind a captured window there is nothing — its corners and any translucent
 * pane are transparent, which H.264 turns black. Clips sit on this instead.
 */
const BACKDROP: Record<string, string> = {
  dark: "0x0e0e10",
  light: "0xf6f6f6",
};

/** Frames held for their beat's seconds, as an H.264 mp4 the site can loop. */
export async function stitch(
  frames: { file: string; holdSeconds: number }[],
  theme: string,
  out: string,
): Promise<void> {
  const { width, height } = await pixelSize(frames[0].file);
  const dir = path.dirname(frames[0].file);
  const lines = frames.map(
    (f) => `file '${f.file}'\nduration ${f.holdSeconds}`,
  );
  // The concat demuxer drops the last frame's duration unless it repeats.
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = path.join(dir, "frames.txt");
  fs.writeFileSync(list, `${lines.join("\n")}\n`);
  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-filter_complex",
    `color=c=${BACKDROP[theme]}:s=${width}x${height}[bg];` +
      "[bg][0:v]overlay=shortest=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  ]);
}

/** SSIM of two same-sized images, 1 for identical. */
export async function similarity(a: string, b: string): Promise<number> {
  const { stderr } = await run("ffmpeg", [
    "-i",
    a,
    "-i",
    b,
    "-lavfi",
    "ssim",
    "-f",
    "null",
    "-",
  ]);
  const score = /All:([\d.]+)/.exec(stderr)?.[1];

  return score ? Number(score) : 0;
}

export async function pixelSize(
  file: string,
): Promise<{ height: number; width: number }> {
  const { stdout } = await run("sips", [
    "-g",
    "pixelWidth",
    "-g",
    "pixelHeight",
    file,
  ]);
  const width = Number(/pixelWidth: (\d+)/.exec(stdout)?.[1] ?? 0);
  const height = Number(/pixelHeight: (\d+)/.exec(stdout)?.[1] ?? 0);

  return { width, height };
}
