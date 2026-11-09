/**
 * What the Mac app needs on top of a scenario: the scenario says where the
 * story is (a route, a settings section, a scroll), this says how to get the
 * Mac window there and which part of it the site shows.
 */

import type { FixtureBeat, FixtureScenario } from "./fixture/types";

export interface Crop {
  h: number;
  w: number;
  x: number;
  y: number;
}

export interface MacScene {
  /** Renderer routes → where the Mac tells the same story better (`"/"` → `"/agents"`). */
  routes?: Record<string, string>;
  /** A second, cropped PNG (`<id>-detail@<theme>.png`), in captured pixels. */
  crop?: Crop;
  /** Crops every recorded frame, so the clip and its poster are the crop. */
  frameCrop?: Crop;
  /**
   * Window points clicked after the route, in order (a file to open, a fold to
   * expand). SwiftUI lists expose no accessibility labels to an in-process
   * lookup, and the window size is fixed, so a point is the stable handle.
   */
  clicks?: { x: number; y: number }[];
  /** Launch-argument defaults on top of the shared ones (a card folded away). */
  defaults?: Record<string, string>;
  /** Scroll distance per renderer `scrollTo`; the Mac's sections are denser. */
  scrollScale?: number;
}

export const MAC_SCENES: Record<string, MacScene> = {
  parallel: {
    routes: { "/": "/agents" },
    crop: { x: 560, y: 120, w: 2096, h: 440 },
  },
  review: {
    clicks: [{ x: 614, y: 412 }],
    crop: { x: 1030, y: 112, w: 2170, h: 1328 },
  },
  remote: { scrollScale: 0.5 },
  // The finished turn folds into "Worked for…"; open it so the work shows.
  // The context card folds away so the chat and the simulator share the window.
  agent: {
    clicks: [
      { x: 404, y: 202 },
      { x: 389, y: 573 },
    ],
    defaults: { "argus:contextCard.collapsed.agents": "YES" },
    // The chat and the simulator, without the sidebar.
    crop: { x: 630, y: 186, w: 2550, h: 1794 },
  },
  huddle: {
    clicks: [{ x: 404, y: 182 }],
    defaults: { "argus:contextCard.collapsed.agents": "YES" },
  },
  // Home lists sessions, not agents; the Agents screen fills in row by row.
  // Five rows leave the window mostly empty: the clip ends below the sidebar's sessions.
  flock: {
    routes: { "/": "/agents" },
    frameCrop: { x: 0, y: 0, w: 3200, h: 856 },
  },
};

/** Renderer settings sections → the Mac's `SettingsTab`. */
const SETTINGS_TABS: Record<string, string> = {
  "remote-access": "remote",
};

/** One step towards a frame, in DevDriver terms. */
export type Step =
  | { kind: "click"; x: number; y: number }
  | { kind: "route"; path: string }
  | { kind: "scroll"; to: number }
  | { kind: "settings"; tab: string };

/** Where a scenario (or one of its beats) puts the window. */
export function stepsFor(
  target: FixtureBeat | FixtureScenario,
  scene: MacScene,
  initial = false,
): Step[] {
  const steps: Step[] = [];
  const route = target.route && (scene.routes?.[target.route] ?? target.route);
  if (route) {
    steps.push({ kind: "route", path: route });
  }
  // The renderer opens an agent's tab by store; the Mac routes to it.
  for (const [sessionId, agentId] of Object.entries(
    target.activeAgents ?? {},
  )) {
    steps.push({
      kind: "route",
      path: `/sessions/${sessionId}/agents/${agentId}`,
    });
  }
  if (initial) {
    steps.push(
      ...(scene.clicks ?? []).map((at) => ({ kind: "click" as const, ...at })),
    );
  }
  if (target.settingsSection) {
    steps.push({
      kind: "settings",
      tab: SETTINGS_TABS[target.settingsSection] ?? target.settingsSection,
    });
  }
  if ("scrollTo" in target && typeof target.scrollTo === "number") {
    steps.push({
      kind: "scroll",
      to: target.scrollTo * (scene.scrollScale ?? 1),
    });
  }

  return steps;
}
