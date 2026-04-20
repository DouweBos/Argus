/**
 * Peer dependency detection.
 *
 * Argus shells out to several external CLIs (claude, git, xcrun, adb, …).
 * Rather than failing only when the user tries to use a feature whose binary
 * is missing, we probe them up front and surface the result on the home
 * screen so users know exactly what they need to install.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getConductorBin } from "../conductor/logger";

const execFileAsync = promisify(execFile);

export type DependencySeverity = "optional" | "required";

export interface DependencyStatus {
  /** Machine-readable id, e.g. "claude". */
  id: string;
  /** User-facing name, e.g. "Claude Code CLI". */
  name: string;
  /** What this dep unlocks — shown in the "missing" message. */
  purpose: string;
  /** `required` deps break core functionality; `optional` deps gate a feature. */
  severity: DependencySeverity;
  installed: boolean;
  /** Platforms where this dep is relevant. If the current platform isn't in the list we skip the check. */
  platforms: NodeJS.Platform[];
  /** Resolved absolute path, when installed. */
  resolvedPath?: string;
  /** Installation hint to show when missing. */
  hint: string;
}

export interface DependencyReport {
  dependencies: DependencyStatus[];
  missingRequired: number;
  missingOptional: number;
  /** Platform the checks ran on — renderer uses this to tailor wording. */
  platform: NodeJS.Platform;
}

// ---------------------------------------------------------------------------
// Individual probes
// ---------------------------------------------------------------------------

/**
 * Resolve a binary by name using `which` (POSIX) or `where` (Windows).
 *
 * Returns the absolute path if found, `null` otherwise. We intentionally
 * swallow errors — a non-zero exit means "not on PATH", not a failure of
 * the probe.
 */
export async function resolveBinary(binary: string): Promise<string | null> {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(cmd, [binary]);
    const resolved = stdout.split(/\r?\n/)[0]?.trim();

    return resolved ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Common default Android SDK roots per platform. Checked when
 * `$ANDROID_HOME` / `$ANDROID_SDK_ROOT` aren't set — this is the typical case
 * in a packaged Electron app where the shell env doesn't propagate.
 */
export function defaultAndroidSdkRoots(
  home: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "darwin") {
    return [path.join(home, "Library", "Android", "sdk")];
  }
  if (platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");

    return [path.join(localAppData, "Android", "Sdk")];
  }

  return [path.join(home, "Android", "Sdk")];
}

/**
 * Resolve an Android SDK binary from `$ANDROID_HOME` / `$ANDROID_SDK_ROOT`
 * first, then well-known default SDK locations per platform, then PATH.
 */
export async function resolveAndroidBinary(
  binary: string,
  subdir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const roots: string[] = [];
  const envRoot = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (envRoot) {
    roots.push(envRoot);
  }
  roots.push(...defaultAndroidSdkRoots());

  for (const root of roots) {
    const candidate = path.join(root, subdir, binary);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return resolveBinary(binary);
}

// ---------------------------------------------------------------------------
// Dependency catalog
// ---------------------------------------------------------------------------

interface DependencySpec {
  id: string;
  name: string;
  purpose: string;
  severity: DependencySeverity;
  platforms: NodeJS.Platform[];
  hint: string;
  /** Returns resolved path when installed, `null` when missing. */
  probe: () => Promise<string | null>;
}

const ALL_PLATFORMS: NodeJS.Platform[] = ["darwin", "linux", "win32"];

const SPECS: DependencySpec[] = [
  {
    id: "claude",
    name: "Claude Code CLI",
    purpose: "Required to spawn and run agents.",
    severity: "required",
    platforms: ALL_PLATFORMS,
    hint: "Install from https://docs.anthropic.com/en/docs/claude-code",
    probe: () => resolveBinary("claude"),
  },
  {
    id: "git",
    name: "Git",
    purpose: "Required for worktrees, branches, diffs, and merges.",
    severity: "required",
    platforms: ALL_PLATFORMS,
    hint: "Install git from https://git-scm.com/downloads",
    probe: () => resolveBinary("git"),
  },
  {
    id: "xcrun",
    name: "Xcode Command Line Tools",
    purpose: "Needed to list and control iOS simulators.",
    severity: "optional",
    platforms: ["darwin"],
    hint: "Run `xcode-select --install` in a terminal.",
    probe: () => resolveBinary("xcrun"),
  },
  {
    id: "adb",
    name: "Android Debug Bridge (adb)",
    purpose: "Needed to list and control Android devices and emulators.",
    severity: "optional",
    platforms: ALL_PLATFORMS,
    hint: "Install Android Studio, then set $ANDROID_HOME or add `adb` to PATH.",
    probe: () => resolveAndroidBinary("adb", "platform-tools"),
  },
  {
    id: "emulator",
    name: "Android Emulator",
    purpose: "Needed to boot Android AVDs from Argus.",
    severity: "optional",
    platforms: ALL_PLATFORMS,
    hint: "Install the Android emulator via Android Studio's SDK Manager.",
    probe: () => resolveAndroidBinary("emulator", "emulator"),
  },
  {
    id: "conductor",
    name: "Conductor CLI",
    purpose: "Used by agents for iOS/Android/web device interaction.",
    severity: "optional",
    platforms: ALL_PLATFORMS,
    hint: "Reinstall Argus dependencies with `pnpm install` to restore it.",
    probe: async () => {
      const bin = getConductorBin();

      return fs.existsSync(bin) ? bin : null;
    },
  },
];

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function checkDependencies(): Promise<DependencyReport> {
  const platform = process.platform;

  const results = await Promise.all(
    SPECS.map(async (spec): Promise<DependencyStatus> => {
      const applicable = spec.platforms.includes(platform);
      if (!applicable) {
        return {
          id: spec.id,
          name: spec.name,
          purpose: spec.purpose,
          severity: spec.severity,
          installed: true,
          platforms: spec.platforms,
          hint: spec.hint,
        };
      }
      const resolvedPath = await spec.probe();

      return {
        id: spec.id,
        name: spec.name,
        purpose: spec.purpose,
        severity: spec.severity,
        installed: resolvedPath !== null,
        platforms: spec.platforms,
        resolvedPath: resolvedPath ?? undefined,
        hint: spec.hint,
      };
    }),
  );

  const applicable = results.filter((d) => d.platforms.includes(platform));
  const missingRequired = applicable.filter(
    (d) => d.severity === "required" && !d.installed,
  ).length;
  const missingOptional = applicable.filter(
    (d) => d.severity === "optional" && !d.installed,
  ).length;

  return {
    dependencies: results,
    missingRequired,
    missingOptional,
    platform,
  };
}

export const __test = { SPECS, resolveBinary, resolveAndroidBinary };
