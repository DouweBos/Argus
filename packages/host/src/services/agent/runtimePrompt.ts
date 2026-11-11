/**
 * The "Runtime Environment" guide: how an agent drives devices with the
 * `conductor` CLI Argus ships. One text, given verbatim to the main agent (in
 * its system prompt) and to every subagent it spawns (via `SubagentStart`).
 */

import type { AttachedDevice } from "./models";
import type {
  AndroidDeviceSession,
  BrowserSession,
  SimulatorReservation,
} from "../../state";
import type { RuntimePlatform } from "../session/models";
import { detectPlatforms } from "../onboarding/argusJson";
import { toolEnabled } from "../tools/state";

export interface RuntimeContext {
  platforms: ReadonlySet<RuntimePlatform>;
  iosReservation: SimulatorReservation | null;
  /** Handed to the agent at spawn, on top of the reservation. */
  attachedDevices: AttachedDevice[];
  androidDevices: AndroidDeviceSession[];
  browserSession: BrowserSession | null;
  browserUrl: string | null;
}

export const CONDUCTOR_GUIDE = [
  "### Use conductor for all device work",
  "",
  "- Use `conductor` for every simulator, emulator, browser and macOS-app task: booting, installing, launching, tapping, typing, gestures, rotation, screenshots, UI hierarchy, logs. That includes throwaway devices you create yourself.",
  "- Prefer it over `xcrun simctl`, `adb`, AppleScript or a driver you write yourself. Long-press, rotation, multi-touch, deep links and permissions are all supported — check `conductor --help` before deciding something can't be done.",
  "- Start with `conductor workspace info` (project type, bundle IDs, Metro port, devices).",
  "- Main verbs: `list-devices`, `start-device`, `install-app`, `launch-app`, `tap-on` (`--long-press`, `--double-tap`, `--at x,y`), `swipe`, `scroll-until-visible`, `input-text`, `press-key`, `set-orientation`, `open-link`, `take-screenshot`, `inspect` (accessibility hierarchy), `capture-ui` (screenshot + hierarchy in one call), `run-sequence --file plan.json` (several steps in one call), `logs`, `crashes`. `conductor <command> --help` covers the rest.",
  "- Asked what's on screen? Answer from `conductor capture-ui`, not from memory.",
  "- The devices below are the user's live views. Don't erase, delete or shut them down, don't use `--clear-state` / `--clear-keychain` on them unless asked, and never touch another agent's device. For destructive experiments, boot your own with `conductor start-device` and stop it when you're done.",
].join("\n");

/** The guide ships unless device control is off in Tools — app-wide, for this project, or for this agent. */
export function deviceControlEnabled(
  projectTools: { disabled?: string[] } | null | undefined,
  agentDisabled: readonly string[] = [],
): boolean {
  return (
    toolEnabled("device-control") &&
    !(projectTools?.disabled ?? []).includes("device-control") &&
    !agentDisabled.includes("device-control")
  );
}

/**
 * The runtimes to describe: an explicit override, else what onboarding
 * detection infers from the repo. A device already attached to the agent
 * always counts.
 */
export function resolveRuntimePlatforms(opts: {
  override?: RuntimePlatform[];
  repoRoot: string;
  hasIosReservation: boolean;
  hasBrowserSession: boolean;
  attachedDevices?: AttachedDevice[];
}): Set<RuntimePlatform> {
  const platforms = new Set<RuntimePlatform>(
    opts.override?.length ? opts.override : detectRepoPlatforms(opts.repoRoot),
  );
  if (opts.hasIosReservation) {
    platforms.add("ios");
  }
  if (opts.hasBrowserSession) {
    platforms.add("web");
  }
  for (const d of opts.attachedDevices ?? []) {
    platforms.add(d.platform);
  }

  return platforms;
}

function detectRepoPlatforms(repoRoot: string): RuntimePlatform[] {
  try {
    return detectPlatforms(repoRoot);
  } catch {
    return [];
  }
}

/** The full guide, or null when the project has no runtime to drive. */
export function buildRuntimeSection(ctx: RuntimeContext): string | null {
  const { platforms } = ctx;
  if (platforms.size === 0) {
    return null;
  }
  const lines = [
    "## Runtime Environment",
    "",
    "You are running inside **Argus**, which ships the `conductor` CLI. The user watches this project's runtime views (simulators, emulators, browser) next to the chat.",
    "",
    CONDUCTOR_GUIDE,
  ];
  if (platforms.has("ios")) {
    lines.push(
      "",
      ...iosLines(
        ctx.iosReservation,
        ctx.attachedDevices.filter((d) => d.platform === "ios"),
      ),
    );
  }
  if (platforms.has("tvos")) {
    lines.push(
      "",
      "### tvOS simulator",
      "",
      "Find the booted tvOS simulator with `conductor list-devices` and target it with `--device <udid>`.",
    );
  }
  if (platforms.has("android")) {
    lines.push(
      "",
      ...androidLines(
        ctx.androidDevices,
        ctx.attachedDevices.filter((d) => d.platform === "android"),
      ),
    );
  }
  if (platforms.has("ios") || platforms.has("android")) {
    lines.push(
      "",
      "React Native: `conductor metro reload` after JS edits (no native rebuild); `conductor debug evaluate '<expr>'`, `conductor debug component-tree` and `conductor network logs` for the running app.",
    );
  }
  if (platforms.has("web")) {
    lines.push("", ...webLines(ctx.browserSession, ctx.browserUrl));
  }

  return lines.join("\n");
}

function attachedLine(d: AttachedDevice): string {
  return `- **${d.name}**: \`conductor <command> --device ${d.id}\``;
}

function iosLines(
  reservation: SimulatorReservation | null,
  attached: AttachedDevice[],
): string[] {
  const head = [
    attached.length > 0 ? "### iOS simulators" : "### iOS simulator",
    "",
  ];
  const lines: string[] = [];
  if (reservation) {
    lines.push(
      `Your simulator is **${reservation.deviceName}** (UDID \`${reservation.udid}\`, also \`$CONDUCTOR_IOS_DEVICE_ID\`), reserved for this agent. \`conductor\` targets it when you pass no \`--device\`.`,
    );
  } else if (attached.length === 0) {
    lines.push(
      "A simulator is reserved for you the first time you run `conductor` without `--device` — you don't need `start-device` for it.",
    );
  }
  if (attached.length > 0) {
    lines.push(
      reservation
        ? "Also yours, for this run — always pass `--device`:"
        : `Yours for this run — \`conductor\` without \`--device\` targets **${attached[0].name}**:`,
      ...attached.map(attachedLine),
    );
  }
  const fallback = attached.at(0);
  const named = reservation
    ? { name: reservation.deviceName, udid: reservation.udid }
    : fallback && { name: fallback.name, udid: fallback.id };
  if (named) {
    lines.push(
      `Tools outside conductor must name a device, or they install on whichever simulator booted first and collide with other agents: \`pnpm ios --device "${named.name}"\`, \`xcodebuild -destination 'id=${named.udid}'\`.`,
    );
  }

  return [...head, ...lines];
}

function androidLines(
  devices: AndroidDeviceSession[],
  attached: AttachedDevice[],
): string[] {
  const head = ["### Android emulator", ""];
  const shared = devices.filter(
    (d) => !attached.some((a) => a.id === d.serial),
  );
  if (shared.length === 0 && attached.length === 0) {
    return [
      ...head,
      "Find a booted device with `conductor list-devices` and target it with `--device <serial>`.",
    ];
  }

  return [
    ...head,
    ...(attached.length > 0
      ? ["Yours for this run:", ...attached.map(attachedLine)]
      : []),
    ...(attached.length > 0 && shared.length > 0
      ? ["Also open in Argus:"]
      : []),
    ...shared.map(
      (d) =>
        `- **${d.deviceName}** (${d.type}): \`conductor <command> --device ${d.serial}\``,
    ),
  ];
}

function webLines(
  session: BrowserSession | null,
  browserUrl: string | null,
): string[] {
  const at = browserUrl ? ` at **${browserUrl}**` : "";
  const intro = session
    ? `A browser view${at} is attached to this session; "the page" or "the site" means it.`
    : `No browser view is open yet — the user can open one in the runtime panel${browserUrl ? ` (defaults to **${browserUrl}**)` : ""}.`;

  return [
    "### Web browser",
    "",
    intro,
    "Target it with `--device web`: Argus wires that to the session's webview over CDP, so no separate window opens. `set-viewport --preset mobile|tablet|desktop` for responsive checks, `take-screenshot --full-page` for the whole document. If the webview reloads, run `conductor daemon-stop --device web` once to reconnect.",
  ];
}
