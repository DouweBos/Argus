/**
 * Marketing screenshots, start to finish: boot Vite, drive a conductor web
 * device through every fixture scenario in both themes, write PNGs to
 * `shots/out/`.
 *
 * `--check` compares against the committed references instead of overwriting
 * them, so a UI change that breaks the site's imagery fails the build.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { scenarios } from "../app/lib/fixture/scenarios/index.js";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "shots/out");
const PORT = 1420;
const VIEWPORT = { width: 1600, height: 1000, scale: 2 };

const THEMES = ["dark", "light"] as const;

/**
 * A second, cropped capture per scenario. A whole 1600x1000 window scaled into
 * a web column is unreadable; these are the regions that actually carry the
 * pitch. Coordinates are stable because the captures are deterministic.
 */
const CROPS: Record<string, { x: number; y: number; w: number; h: number }> = {
  parallel: { x: 784, y: 288, w: 2096, h: 840 },
  review: { x: 1024, y: 208, w: 2080, h: 1328 },
};

/** Any real screen has far more than this; a blank one has almost none. */
const MIN_TEXT_CHARS = 200;

const check = process.argv.includes("--check");

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** Conductor needs an explicit device: unscoped calls pick a simulator. */
let device = "";

async function conductor(...args: string[]): Promise<string> {
  const { stdout } = await run(
    "conductor",
    device ? [...args, "--device", device] : args,
    { cwd: ROOT, maxBuffer: 1024 * 1024 * 32 },
  );

  return stdout;
}

async function waitForVite(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite never came up on :${PORT}`);
}

/** Poll the flag the fixture bridge sets once the tree has flushed. */
async function waitForShotReady(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const out = await conductor(
      "debug",
      "evaluate",
      "document.documentElement.dataset.shotReady === 'true'",
    );
    if (out.includes("true")) {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("shot-ready never set");
}

async function assertNoErrors(label: string): Promise<void> {
  const out = await conductor(
    "debug",
    "evaluate",
    "JSON.stringify(window.__argusFixtureErrors || [])",
  );
  if (!out.includes("[]")) {
    throw new Error(`${label} rendered with errors: ${out.trim()}`);
  }

  // An error boundary catches its error, so `window.onerror` stays clean and a
  // broken panel would otherwise be captured as if it were the real screen.
  const boundary = await conductor(
    "debug",
    "evaluate",
    "document.body.innerText.includes('Something went wrong') ? (document.querySelector('h2 + p')?.textContent ?? 'unknown') : ''",
  );
  if (boundary.trim().length > 0) {
    throw new Error(`${label} hit an error boundary: ${boundary.trim()}`);
  }

  // A blank page throws nothing and mounts no boundary, so without this a
  // capture of an empty window counts as a pass.
  const text = await conductor(
    "debug",
    "evaluate",
    "document.body.innerText.trim().length",
  );
  const chars = Number.parseInt(text.trim().split(/\s+/).pop() ?? "0", 10);
  if (!Number.isFinite(chars) || chars < MIN_TEXT_CHARS) {
    throw new Error(`${label} rendered almost nothing (${chars} chars)`);
  }
}

/**
 * Records a scenario's beats as frames and stitches them into an mp4. Conductor
 * only records real devices, and a timed screen capture of a web page is not
 * reproducible — stepping the fixture and shooting between steps is.
 */
async function record(scenario: string, theme: string): Promise<void> {
  const beats = scenarios[scenario]?.beats ?? [];
  if (beats.length === 0) {
    return;
  }
  const label = `${scenario}@${theme}`;
  const dir = resolve(OUT, `.frames-${label}`);
  await mkdir(dir, { recursive: true });

  const parts: string[] = [];
  for (let i = 0; i < beats.length; i += 1) {
    const advanced = await conductor(
      "debug",
      "evaluate",
      "window.__argusFixtureBeat ? window.__argusFixtureBeat() : -1",
    );
    if (advanced.includes("-1")) {
      throw new Error(`${label} ran out of beats at ${i}`);
    }
    const frame = resolve(dir, `${String(i).padStart(3, "0")}.png`);
    await conductor("take-screenshot", "--output", frame);
    parts.push(`file '${frame}'\nduration ${beats[i].holdSeconds ?? 2}`);
  }
  // concat demuxer needs the last frame repeated or it drops its duration
  parts.push(
    `file '${resolve(dir, `${String(beats.length - 1).padStart(3, "0")}.png`)}'`,
  );

  const list = resolve(dir, "frames.txt");
  await writeFile(list, `${parts.join("\n")}\n`);
  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    resolve(OUT, `${scenario}@${theme}.mp4`),
  ]);
  const posterIndex = Math.min(
    scenarios[scenario]?.posterBeat ?? beats.length - 1,
    beats.length - 1,
  );
  await copyFile(
    resolve(dir, `${String(posterIndex).padStart(3, "0")}.png`),
    resolve(OUT, `${scenario}-poster@${theme}.png`),
  );
  await rm(dir, { recursive: true, force: true });
  log(`  ↳ recorded ${label}.mp4 (${beats.length} beats)`);
}

async function capture(scenario: string, theme: string): Promise<void> {
  const label = `${scenario}@${theme}`;
  const route = scenarios[scenario]?.route ?? "/";
  const url = `http://localhost:${PORT}/?fixture=${scenario}&shot=1&theme=${theme}&route=${encodeURIComponent(route)}`;

  // Vite re-optimises dependencies on the first request after a lockfile
  // change, and a navigation that lands mid-rebuild renders an empty document.
  // Retry the load rather than capture a blank window.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await conductor("open-link", url);
      await waitForShotReady();
      await assertNoErrors(label);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      log(`  ↻ ${label} attempt ${attempt + 1} failed, reloading`);
    }
  }
  if (lastError) {
    throw lastError;
  }

  if (check) {
    // Compares against the committed shot: those are the images the README and
    // the site actually ship, so they are the only reference worth holding to.
    await conductor(
      "assert-screenshot",
      resolve(OUT, `${label}.png`),
      "--threshold",
      "0.02",
    );
    log(`✓ ${label} matches reference`);

    return;
  }
  const full = resolve(OUT, `${label}.png`);
  await conductor("take-screenshot", "--output", full);

  const crop = CROPS[scenario];
  if (crop) {
    await run("sips", [
      "-c",
      String(crop.h),
      String(crop.w),
      "--cropOffset",
      String(crop.y),
      String(crop.x),
      full,
      "--out",
      resolve(OUT, `${scenario}-detail@${theme}.png`),
    ]);
  }
  log(`✓ ${label}`);
  if (!check) {
    await record(scenario, theme);
  }
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  let vite: ChildProcess | null = null;
  try {
    vite = spawn("pnpm", ["dev:vite"], { cwd: ROOT, stdio: "ignore" });
    await waitForVite();

    const started = await run("conductor", [
      "start-device",
      "--platform",
      "web",
      "--browser",
      "chromium",
    ]);
    // Matches both "Web driver ready: Chromium (web:…)" and the
    // "already running: web:…" reply from a device left over from a prior run.
    device = /web:[\w:-]+/.exec(started.stdout)?.[0] ?? "";
    if (!device) {
      throw new Error(`could not parse device id from: ${started.stdout}`);
    }
    await conductor(
      "set-viewport",
      "--width",
      String(VIEWPORT.width),
      "--height",
      String(VIEWPORT.height),
      "--scale",
      String(VIEWPORT.scale),
    );

    for (const scenario of Object.keys(scenarios)) {
      for (const theme of THEMES) {
        await capture(scenario, theme);
      }
    }
  } finally {
    if (device) {
      await conductor("stop-device").catch(() => undefined);
    }
    vite?.kill();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exitCode = 1;
});
