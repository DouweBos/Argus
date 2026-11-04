/**
 * Stand-in for the Electron preload bridge, so the real app renders from canned
 * data in a plain browser tab. Shimming `window.argus` rather than the
 * transport covers the handful of callers that reach for the bridge directly.
 *
 * Only reachable via `?fixture=<id>`; nothing imports this in a normal run.
 */

import type { FixtureEvent, FixtureScenario } from "./types";
import { reply } from "./reply";
import {
  applyActiveAgents,
  applyFixtureRoute,
  applySettingsSection,
} from "./route";
import { scenarios } from "./scenarios";

const calls: string[] = [];
const events = new Map<string, Set<(payload: unknown) => void>>();

declare global {
  interface Window {
    /** Advances a recording by one beat. Resolves once the frame is settled. */
    __argusFixtureBeat?: () => Promise<number>;
    __argusFixtureCalls?: string[];
    __argusFixtureErrors?: string[];
    __argusFixtureWarnings?: string[];
  }
}

/**
 * Screenshots must never race the first paint. The runner waits on this
 * instead of sleeping — two frames after the last reply settles, the tree has
 * flushed.
 */
function markReadyWhenIdle(): void {
  let timer = 0;
  const settle = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.documentElement.dataset.shotReady = "true";
        });
      });
    }, 250);
  };
  window.addEventListener("argus-fixture-reply", settle);
  settle();
}

/** Freeze anything that would make two runs of the same scenario differ. */
function freezeMotion(): void {
  const style = document.createElement("style");
  style.textContent = `*, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }`;
  document.head.append(style);
}

/**
 * Exposes `window.__argusFixtureBeat()` for recorded scenarios. The runner
 * drives it one beat at a time and screenshots between calls, so the clip is
 * a deterministic sequence rather than a timed screen capture.
 */
function installBeatDriver(
  scenario: FixtureScenario,
  emit: (event: FixtureEvent) => void,
): void {
  const beats = scenario.beats ?? [];
  let index = 0;

  window.__argusFixtureBeat = async () => {
    const beat = beats[index];
    if (!beat) {
      return -1;
    }
    index += 1;
    for (const event of beat.events ?? []) {
      emit(event);
    }
    await applyActiveAgents(beat.activeAgents ?? {});
    await applySettingsSection(beat.settingsSection);
    if (beat.route) {
      await applyFixtureRoute(beat.route);
    }
    if (typeof beat.scrollTo === "number") {
      const pane = [...document.querySelectorAll<HTMLElement>("*")]
        .filter((el) => el.scrollHeight - el.clientHeight > 80)
        .sort(
          (a, b) =>
            b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
        )[0];
      pane?.scrollTo({ top: beat.scrollTo, behavior: "instant" });
    }
    // Two frames is what it takes for the tree to flush after a store write.
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
    });

    return index;
  };
}

export function installStubBridge(id: string, params: URLSearchParams): void {
  const scenario = scenarios[id];
  const errors: string[] = [];
  window.__argusFixtureErrors = errors;
  window.addEventListener("error", (e) => {
    errors.push(`error: ${e.message} @ ${e.filename}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    errors.push(`rejection: ${String(e.reason)}`);
  });
  // Kept separate from `errors`: React's dev-mode warnings come through here
  // too, and those are the app's business, not a reason to fail a capture.
  const warnings: string[] = [];
  window.__argusFixtureWarnings = warnings;
  // Aliased rather than touched directly: this tees the sink instead of
  // logging through it, which is the one thing `no-console` is not about.
  const sink = globalThis.console as unknown as Record<
    string,
    (...args: unknown[]) => void
  >;
  const nativeError = sink.error.bind(sink);
  sink.error = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
    nativeError(...args);
  };

  if (!scenario) {
    errors.push(`unknown fixture scenario: ${id}`);
  }
  const active: FixtureScenario = scenario ?? { channels: {}, id };

  for (const [key, value] of Object.entries(active.storage ?? {})) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  const theme = params.get("theme");
  if (theme) {
    // Stored raw, not JSON — matches what `themeStore` reads back.
    localStorage.setItem("argus:theme", theme);
  }
  if (params.get("shot") === "1") {
    freezeMotion();
  }

  window.__argusFixtureCalls = calls;
  window.argus = {
    getFilePath: () => "",
    invoke: <T>(channel: string, args?: Record<string, unknown>) => {
      calls.push(channel);
      window.dispatchEvent(new Event("argus-fixture-reply"));

      return Promise.resolve(reply(active, channel, args ?? {}) as T);
    },
    on: <T>(event: string, callback: (payload: T) => void) => {
      const set = events.get(event) ?? new Set();
      events.set(event, set);
      set.add(callback as (payload: unknown) => void);

      return () => set.delete(callback as (payload: unknown) => void);
    },
    send: (channel: string) => {
      calls.push(`send:${channel}`);
    },
    setZoomFactor: () => undefined,
  };

  // Events land after boot has had a turn to subscribe; `markReadyWhenIdle`
  // re-arms on each one, so the screenshot still waits for the last of them.
  const emit = (event: FixtureEvent) => {
    for (const cb of events.get(event.channel) ?? []) {
      cb(event.payload);
    }
    window.dispatchEvent(new Event("argus-fixture-reply"));
  };

  /**
   * Strict phases, because every step depends on the one before it: an agent
   * has to be registered before it can be made active, the session has to be
   * on screen before its transcript means anything, and `agent:event:<id>`
   * listeners only exist once `agent:started` has been handled. Overlapping
   * these produced a different screenshot on almost every run.
   */
  installBeatDriver(active, emit);

  const registrations = (active.events ?? []).filter((e) => !e.delayMs);
  const streamed = (active.events ?? []).filter((e) => e.delayMs);

  setTimeout(() => {
    registrations.forEach(emit);

    setTimeout(() => {
      Promise.all([
        applyFixtureRoute(active.route),
        applyActiveAgents(active.activeAgents ?? {}),
        applySettingsSection(active.settingsSection),
      ])
        .then(() => {
          window.dispatchEvent(new Event("argus-fixture-reply"));
          streamed.forEach((event, index) => {
            setTimeout(() => emit(event), index * 30);
          });
          // Only now may the runner shoot. Arming this at install time let the
          // idle window elapse during the phases above, so a capture could land
          // on an empty window.
          setTimeout(markReadyWhenIdle, streamed.length * 30);
        })
        .catch(() => undefined);
    }, 300);
  }, 400);
}
