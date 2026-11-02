/**
 * The "Runtime Environment" guide: how an agent drives devices with the
 * `conductor` CLI Argus ships. One text, given verbatim to the main agent (in
 * its system prompt) and to every subagent it spawns (via `SubagentStart`).
 */

import type {
  AndroidDeviceSession,
  BrowserSession,
  SimulatorReservation,
} from "../../state";
import type { RuntimePlatform } from "../session/models";
import { loadAppSettings } from "../appSettings/store";
import { detectPlatforms } from "../onboarding/argusJson";

export interface RuntimeContext {
  platforms: ReadonlySet<RuntimePlatform>;
  iosReservation: SimulatorReservation | null;
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

/** Whether app settings let agents get the conductor guide. Defaults to on. */
export function conductorGuideEnabled(): boolean {
  return loadAppSettings().conductor_guide !== false;
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
    lines.push("", ...iosLines(ctx.iosReservation));
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
    lines.push("", ...androidLines(ctx.androidDevices));
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

function iosLines(reservation: SimulatorReservation | null): string[] {
  const head = ["### iOS simulator", ""];
  if (!reservation) {
    return [
      ...head,
      "A simulator is reserved for you the first time you run `conductor` without `--device` — you don't need `start-device` for it.",
    ];
  }

  return [
    ...head,
    `Your simulator is **${reservation.deviceName}** (UDID \`${reservation.udid}\`, also \`$CONDUCTOR_IOS_DEVICE_ID\`), reserved for this agent. \`conductor\` targets it when you pass no \`--device\`.`,
    `Tools outside conductor must name it, or they install on whichever simulator booted first and collide with other agents: \`pnpm ios --device "${reservation.deviceName}"\`, \`xcodebuild -destination 'id=${reservation.udid}'\`.`,
  ];
}

function androidLines(devices: AndroidDeviceSession[]): string[] {
  const head = ["### Android emulator", ""];
  if (devices.length === 0) {
    return [
      ...head,
      "Find a booted device with `conductor list-devices` and target it with `--device <serial>`.",
    ];
  }

  return [
    ...head,
    ...devices.map(
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
