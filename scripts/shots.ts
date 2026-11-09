/**
 * Marketing screenshots and clips of Argus for Mac, start to finish: build the
 * Debug app, attach it to a fixture host per scenario and theme, capture its
 * window, write PNGs and mp4s to `shots/out/`.
 *
 * `--check` compares against the committed references instead of overwriting
 * them, so a UI change that breaks the site's imagery fails the build.
 * `--no-build` reuses the last build; `--only <id>` runs one scenario.
 */

import type { FixtureEvent, FixtureScenario } from "./shots/fixture/types.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "@argus/remote-protocol";
import { sleep } from "./shots/devDriver";
import { scenarios } from "./shots/fixture/scenarios/index.js";
import { startFixtureHost } from "./shots/fixtureHost";
import {
  crop,
  pixelSize,
  similarity,
  stableCapture,
  stitch,
} from "./shots/frames";
import {
  WINDOW,
  buildApp,
  bundleForShots,
  launchApp,
  type RunningApp,
} from "./shots/macApp";
import { MacFixture } from "./shots/macFixture";
import { MAC_SCENES, stepsFor, type MacScene, type Step } from "./shots/scenes";
import { synthesize } from "./shots/synth";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "shots/out");
const THEMES = ["dark", "light"] as const;
/** Below this a capture differs from its reference in more than antialiasing. */
const MIN_SIMILARITY = 0.97;

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

interface Shoot {
  app: RunningApp;
  /** Points scrolled so far: a beat's `scrollTo` is absolute, the wheel relative. */
  scrolled: number;
  /** The window frames come from: the main one, or Settings once opened. */
  window: number;
}

async function waitForData(app: RunningApp): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const state = await app.driver.run({ op: "state" });
    if (Number(state.projects) > 0) {
      return;
    }
    await sleep(200);
  }
  throw new Error("the app never listed the fixture's projects");
}

/** Behind everything and on every Space: captured, never in the user's way. */
async function backstage(shoot: Shoot): Promise<void> {
  const out = await shoot.app.driver.run({
    op: "backstage",
    window: shoot.window,
  });
  if (out.error) {
    throw new Error(`backstage: ${String(out.error)}`);
  }
}

async function apply(shoot: Shoot, steps: Step[]): Promise<void> {
  const { driver } = shoot.app;
  for (const step of steps) {
    if (step.kind === "route") {
      const out = await driver.run({ op: "routePath", path: step.path });
      if (out.error) {
        throw new Error(`route ${step.path}: ${String(out.error)}`);
      }
    } else if (step.kind === "click") {
      // A transcript row re-measures after the click before it; one landing mid-layout is lost.
      await sleep(1200);
      // A list ignores clicks in a window that isn't key; key within this app only.
      await driver.run({ op: "makeKey", window: shoot.window });
      await driver.run({
        op: "clickAt",
        window: shoot.window,
        x: step.x,
        y: step.y,
      });
    } else if (step.kind === "settings") {
      await driver.run({ op: "settingsTab", tab: step.tab });
      await driver.run({ op: "menu", title: "Settings…" });
      await sleep(800);
      const { windows } = await driver.run({ op: "windows" });
      const line = (windows as string[]).find(
        (w) =>
          w.includes("visible=true") &&
          !w.includes("id=main") &&
          w.includes("level=0"),
      );
      if (!line) {
        throw new Error("Settings never opened");
      }
      shoot.window = Number.parseInt(line, 10);
      // The same frame as the main window's captures.
      await driver.run({
        op: "resize",
        window: shoot.window,
        width: WINDOW.width,
        height: WINDOW.height,
      });
      await backstage(shoot);
    } else {
      // Mid-window: the settings column, or a screen's list.
      await driver.run({
        op: "scrollAt",
        window: shoot.window,
        x: WINDOW.width / 2,
        y: WINDOW.height / 2,
        dy: -Math.round(step.to - shoot.scrolled),
      });
      shoot.scrolled = step.to;
    }
  }
}

function themed(scenario: FixtureScenario, theme: string, fixture: MacFixture) {
  const settings = synthesize(COMMANDS.get_app_settings.result) as Record<
    string,
    unknown
  >;

  return (method: string, params: Record<string, unknown>) => {
    if (method === "get_app_settings") {
      return { ...settings, theme };
    }

    return fixture.resolve(method, params);
  };
}

/** Scenario events in the renderer's order: registrations, then the streamed ones. */
function boot(scenario: FixtureScenario, fixture: MacFixture): void {
  const events = scenario.events ?? [];
  const ordered: FixtureEvent[] = [
    ...events.filter((e) => !e.delayMs),
    ...events.filter((e) => e.delayMs),
  ];
  ordered.forEach((e) => fixture.apply(e));
}

async function capture(id: string, theme: string, app: string): Promise<void> {
  const scenario = scenarios[id];
  const scene: MacScene = MAC_SCENES[id] ?? {};
  const label = `${id}@${theme}`;
  // Short: a Unix socket path is capped at 104 bytes.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "argus-shot-"));
  const home = path.join(work, "home");
  const fixture = new MacFixture(scenario, theme);
  await fixture.materialize(path.join(work, "wt"));
  const host = await startFixtureHost(home, themed(scenario, theme, fixture));
  fixture.attach(host);
  boot(scenario, fixture);

  const running = await launchApp(app, home, work, scene.defaults);
  try {
    await waitForData(running);
    await running.driver.run({
      op: "resizeWindow",
      width: WINDOW.width,
      height: WINDOW.height,
    });
    const shoot: Shoot = {
      app: running,
      scrolled: 0,
      window: await running.windowNumber(),
    };
    await backstage(shoot);
    await apply(shoot, stepsFor(scenario, scene, true));

    const shot = path.join(work, `${label}.png`);
    // A running agent's spinner never settles; its last frame is as good as any.
    await stableCapture(shoot.window, shot);
    if (fixture.mismatches.length > 0) {
      log(
        `  ! ${label} answered off-schema:\n    ${fixture.mismatches.join("\n    ")}`,
      );
    }
    const target = path.join(OUT, `${label}.png`);
    if (check) {
      const score = await similarity(shot, target);
      if (score < MIN_SIMILARITY) {
        throw new Error(
          `${label} differs from its reference (SSIM ${score.toFixed(4)})`,
        );
      }
      log(`✓ ${label} matches reference (SSIM ${score.toFixed(4)})`);

      return;
    }
    fs.copyFileSync(shot, target);
    const size = await pixelSize(target);
    if (scene.crop) {
      await crop(
        target,
        scene.crop,
        path.join(OUT, `${id}-detail@${theme}.png`),
      );
    }
    log(`✓ ${label} (${size.width}x${size.height})`);
    await record(scenario, scene, label, shoot, fixture, work);
  } finally {
    await running.quit();
    await host.close();
    fixture.dispose();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Each beat: push its events, move the window, shoot; then stitch. */
async function record(
  scenario: FixtureScenario,
  scene: MacScene,
  label: string,
  shoot: Shoot,
  fixture: MacFixture,
  work: string,
): Promise<void> {
  const beats = scenario.beats ?? [];
  if (beats.length === 0) {
    return;
  }
  const frames: { file: string; holdSeconds: number }[] = [];
  for (const [index, beat] of beats.entries()) {
    (beat.events ?? []).forEach((e) => fixture.apply(e));
    await apply(shoot, stepsFor(beat, scene));
    const file = path.join(work, `frame-${String(index).padStart(3, "0")}.png`);
    await stableCapture(shoot.window, file);
    if (scene.frameCrop) {
      await crop(file, scene.frameCrop, file);
    }
    frames.push({ file, holdSeconds: beat.holdSeconds ?? 2 });
  }
  await stitch(frames, label.split("@")[1], path.join(OUT, `${label}.mp4`));
  const poster = Math.min(
    scenario.posterBeat ?? beats.length - 1,
    beats.length - 1,
  );
  fs.copyFileSync(
    frames[poster].file,
    path.join(OUT, `${label.replace("@", "-poster@")}.png`),
  );
  log(`  ↳ recorded ${label}.mp4 (${beats.length} beats)`);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const built = argv.includes("--no-build")
    ? path.join(ROOT, ".build/mac-shots-dd/Build/Products/Debug/Argus.app")
    : await buildApp(ROOT);
  const app = await bundleForShots(built, ROOT);
  const ids = only ? [only] : Object.keys(scenarios);
  for (const id of ids) {
    if (!scenarios[id]) {
      throw new Error(`unknown scenario ${id}`);
    }
    for (const theme of THEMES) {
      await capture(id, theme, app);
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exitCode = 1;
});
