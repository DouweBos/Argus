/**
 * Inference + save support for generating a project config during onboarding.
 * The result is stored on this machine, never written into the repo.
 */

import type { ArgusConfigSuggestion, DetectedSignal } from "./types";
import type { RuntimePlatform } from "../session/models";
import fs from "node:fs";
import path from "node:path";
import { getProjectConfig, saveProjectConfig } from "../session/argusConfig";

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

type Platform = RuntimePlatform;

interface DetectionContext {
  copy: Set<string>;
  platforms: Set<Platform>;
  repoRoot: string;
  run: { title: string; command: string; restartOnRerun: boolean }[];
  setupCommands: string[];
  signals: DetectedSignal[];
}

/** Join a dir + child path, stripping the "./" prefix when dir is the repo root. */
function joinRel(dir: string, child: string): string {
  if (dir === "." || dir === "") {
    return child;
  }

  return `${dir}/${child}`;
}

const RUN_SCRIPT_KEYS = [
  "dev",
  "start",
  "storybook",
  "ios",
  "android",
  "web",
  "test",
] as const;

function readPackageJson(repoRoot: string): PackageJsonShape | null {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");

    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return null;
  }
}

function exists(repoRoot: string, rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, rel));
}

function firstMatchingDir(
  repoRoot: string,
  candidates: string[],
): string | null {
  for (const c of candidates) {
    if (exists(repoRoot, c)) {
      return c;
    }
  }

  return null;
}

/**
 * Infer an `.argus.json` from a project by looking at package.json, lockfiles,
 * native platform dirs, and common framework signals. Returns both the config
 * and a list of detected signals so the UI can explain *why* each choice was
 * made.
 */
export function suggestArgusJson(repoRoot: string): ArgusConfigSuggestion {
  return inferProject(repoRoot).suggestion;
}

/** The runtimes onboarding detection infers from the repo, sorted. */
export function detectPlatforms(repoRoot: string): RuntimePlatform[] {
  return inferProject(repoRoot).platforms;
}

function inferProject(repoRoot: string): {
  suggestion: ArgusConfigSuggestion;
  platforms: RuntimePlatform[];
} {
  const signals: DetectedSignal[] = [];
  const inferred: string[] = [];
  const platforms = new Set<Platform>();
  const run: { title: string; command: string; restartOnRerun: boolean }[] = [];
  const copy = new Set<string>();
  const setupCommands: string[] = [];
  const workspaceEnv: {
    name: string;
    base_value: number;
    range: number;
    strategy: "hash" | "sequential";
  }[] = [];
  let browserUrl: string | null = null;

  const pkg = readPackageJson(repoRoot);
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  const scripts = pkg?.scripts ?? {};

  if (pkg) {
    signals.push({
      label: "package.json",
      detail: pkg.name ?? "Node project",
      kind: "project",
    });
    inferred.push("package.json");
  }

  const ctx: DetectionContext = {
    repoRoot,
    signals,
    platforms,
    copy,
    setupCommands,
    run,
  };

  // Framework detection (JS/TS only) --------------------------------------
  if (pkg && deps.expo) {
    platforms.add("ios");
    platforms.add("android");
    signals.push({ label: "Expo", detail: deps.expo, kind: "framework" });
    inferred.push("expo");
    if (scripts.start) {
      run.push({
        title: "Expo",
        command: `${pickRunner(repoRoot)} start`,
        restartOnRerun: true,
      });
    }
  } else if (deps["react-native"]) {
    platforms.add("ios");
    platforms.add("android");
    signals.push({
      label: "React Native",
      detail: deps["react-native"],
      kind: "framework",
    });
    inferred.push("react-native");
    if (scripts.start) {
      run.push({
        title: "Metro",
        command: `${pickRunner(repoRoot)} start`,
        restartOnRerun: true,
      });
    }
    workspaceEnv.push({
      name: "RCT_METRO_PORT",
      base_value: 8081,
      range: 100,
      strategy: "sequential",
    });
  } else if (deps.next) {
    platforms.add("web");
    signals.push({ label: "Next.js", detail: deps.next, kind: "framework" });
    inferred.push("next.js");
    browserUrl = "http://localhost:3000";
    workspaceEnv.push({
      name: "PORT",
      base_value: 3000,
      range: 100,
      strategy: "sequential",
    });
  } else if (deps.vite || deps["@vitejs/plugin-react"]) {
    platforms.add("web");
    signals.push({
      label: "Vite",
      detail: deps.vite ?? "react",
      kind: "framework",
    });
    inferred.push("vite");
    browserUrl = "http://localhost:5173";
    workspaceEnv.push({
      name: "VITE_PORT",
      base_value: 5173,
      range: 100,
      strategy: "sequential",
    });
  } else if (deps.nuxt) {
    platforms.add("web");
    signals.push({ label: "Nuxt", detail: deps.nuxt, kind: "framework" });
    inferred.push("nuxt");
    browserUrl = "http://localhost:3000";
  } else if (deps["@sveltejs/kit"]) {
    platforms.add("web");
    signals.push({ label: "SvelteKit", kind: "framework" });
    inferred.push("sveltekit");
    browserUrl = "http://localhost:5173";
  } else if (deps.astro) {
    platforms.add("web");
    signals.push({ label: "Astro", detail: deps.astro, kind: "framework" });
    inferred.push("astro");
    browserUrl = "http://localhost:4321";
  } else if (deps["@remix-run/dev"]) {
    platforms.add("web");
    signals.push({ label: "Remix", kind: "framework" });
    inferred.push("remix");
    browserUrl = "http://localhost:3000";
  } else if (scripts.dev || scripts.start) {
    platforms.add("web");
    inferred.push(scripts.dev ? "scripts.dev" : "scripts.start");
  }

  // Native platform dirs --------------------------------------------------
  const iosDir = firstMatchingDir(repoRoot, ["ios", "apps/ios", "mobile/ios"]);
  if (iosDir) {
    detectIos(ctx, iosDir);
  } else if (looksLikeNativeIosRoot(repoRoot)) {
    detectIos(ctx, ".");
    inferred.push("native-ios");
  }
  const androidDir = firstMatchingDir(repoRoot, [
    "android",
    "apps/android",
    "mobile/android",
  ]);
  if (androidDir) {
    detectAndroid(ctx, androidDir);
  } else if (looksLikeNativeAndroidRoot(repoRoot)) {
    detectAndroid(ctx, ".");
    inferred.push("native-android");
  }

  // Flutter ---------------------------------------------------------------
  if (isFlutterProject(repoRoot)) {
    detectFlutter(ctx);
    inferred.push("flutter");
  }

  // Lockfiles / package managers -----------------------------------------
  const runner = pickRunner(repoRoot);
  if (exists(repoRoot, "pnpm-lock.yaml")) {
    setupCommands.push("pnpm install");
    signals.push({ label: "pnpm", detail: "pnpm-lock.yaml", kind: "tooling" });
    inferred.push("pnpm-lock.yaml");
  } else if (exists(repoRoot, "yarn.lock")) {
    setupCommands.push("yarn install");
    signals.push({ label: "yarn", detail: "yarn.lock", kind: "tooling" });
    inferred.push("yarn.lock");
  } else if (exists(repoRoot, "package-lock.json")) {
    setupCommands.push("npm install");
    signals.push({
      label: "npm",
      detail: "package-lock.json",
      kind: "tooling",
    });
    inferred.push("package-lock.json");
  } else if (exists(repoRoot, "bun.lockb") || exists(repoRoot, "bun.lock")) {
    setupCommands.push("bun install");
    signals.push({ label: "bun", kind: "tooling" });
    inferred.push("bun.lock");
  }

  // node_modules — worth copying so the worktree is usable before `install`
  if (exists(repoRoot, "node_modules")) {
    copy.add("node_modules");
    signals.push({
      label: "node_modules",
      detail: "will be copied",
      kind: "tooling",
    });
  }
  // Copy .claude to preserve agent context
  if (exists(repoRoot, ".claude")) {
    copy.add(".claude");
    signals.push({ label: ".claude", detail: "agent memory", kind: "tooling" });
  }

  // Monorepo signals ------------------------------------------------------
  if (exists(repoRoot, "pnpm-workspace.yaml")) {
    signals.push({ label: "pnpm workspace", kind: "monorepo" });
    inferred.push("pnpm-workspace.yaml");
  }
  if (exists(repoRoot, "turbo.json")) {
    signals.push({ label: "Turborepo", kind: "monorepo" });
    inferred.push("turbo.json");
  }
  if (exists(repoRoot, "nx.json")) {
    signals.push({ label: "Nx", kind: "monorepo" });
    inferred.push("nx.json");
  }
  if (pkg?.workspaces) {
    signals.push({ label: "Yarn/npm workspaces", kind: "monorepo" });
  }

  // Run commands from scripts --------------------------------------------
  for (const key of RUN_SCRIPT_KEYS) {
    if (scripts[key] && !run.find((r) => r.title.toLowerCase() === key)) {
      run.push({
        title: titleCase(key),
        command: `${runner} run ${key}`,
        restartOnRerun: key === "dev" || key === "start",
      });
    }
  }
  if (run.length === 0 && scripts.dev) {
    run.push({
      title: "Dev",
      command: `${runner} run dev`,
      restartOnRerun: true,
    });
  }

  const config: Record<string, unknown> = {
    setup: {
      copy: Array.from(copy).sort(),
      symlink: [],
      commands: setupCommands,
    },
    terminals: [],
    run,
    workspace_env: workspaceEnv,
    protected_branches: ["main", "master"],
  };
  if (browserUrl) {
    config.browser_url = browserUrl;
  }

  return {
    suggestion: { config, inferredFrom: inferred, signals },
    platforms: Array.from(platforms).sort(),
  };
}

function pickRunner(repoRoot: string): string {
  if (exists(repoRoot, "pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (exists(repoRoot, "yarn.lock")) {
    return "yarn";
  }
  if (exists(repoRoot, "bun.lockb") || exists(repoRoot, "bun.lock")) {
    return "bun";
  }

  return "npm";
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- Native project detection -------------------------------------------

function listDir(repoRoot: string, rel: string): string[] {
  try {
    return fs.readdirSync(path.join(repoRoot, rel));
  } catch {
    return [];
  }
}

function looksLikeNativeIosRoot(repoRoot: string): boolean {
  const entries = listDir(repoRoot, ".");

  return (
    entries.some(
      (n) => n.endsWith(".xcodeproj") || n.endsWith(".xcworkspace"),
    ) ||
    entries.includes("Podfile") ||
    entries.includes("Package.swift")
  );
}

function looksLikeNativeAndroidRoot(repoRoot: string): boolean {
  const entries = listDir(repoRoot, ".");
  const hasGradleSettings = entries.some(
    (n) => n === "settings.gradle" || n === "settings.gradle.kts",
  );
  const hasRootBuildGradle = entries.some(
    (n) => n === "build.gradle" || n === "build.gradle.kts",
  );
  const hasGradlew = entries.includes("gradlew");

  return hasGradleSettings || (hasRootBuildGradle && hasGradlew);
}

function detectIos(ctx: DetectionContext, dir: string): void {
  const { repoRoot, signals, platforms, copy, setupCommands } = ctx;
  platforms.add("ios");
  signals.push({
    label: "iOS project",
    detail: dir === "." ? "repo root" : dir,
    kind: "platform",
  });

  if (exists(repoRoot, joinRel(dir, "Podfile"))) {
    signals.push({ label: "CocoaPods", detail: "Podfile", kind: "native" });
    copy.add(joinRel(dir, "Pods"));
    const podCommand = dir === "." ? "pod install" : `cd ${dir} && pod install`;
    if (!setupCommands.includes(podCommand)) {
      setupCommands.push(podCommand);
    }
  }

  const entries = listDir(repoRoot, dir);
  const xcworkspace = entries.find(
    (n) => n.endsWith(".xcworkspace") || n.endsWith(".xcodeproj"),
  );
  if (xcworkspace) {
    signals.push({ label: "Xcode", detail: xcworkspace, kind: "native" });
  }
  if (entries.includes("Package.swift")) {
    signals.push({
      label: "Swift Package Manager",
      detail: "Package.swift",
      kind: "native",
    });
    copy.add(joinRel(dir, ".build"));
  }
  // Xcode's DerivedData default lives outside the repo, but local per-project
  // build output is worth caching when present.
  if (exists(repoRoot, joinRel(dir, "DerivedData"))) {
    copy.add(joinRel(dir, "DerivedData"));
  }
}

function detectAndroid(ctx: DetectionContext, dir: string): void {
  const { repoRoot, signals, platforms, copy } = ctx;
  platforms.add("android");
  signals.push({
    label: "Android project",
    detail: dir === "." ? "repo root" : dir,
    kind: "platform",
  });

  if (exists(repoRoot, joinRel(dir, "gradlew"))) {
    signals.push({ label: "Gradle", kind: "native" });
  }
  copy.add(joinRel(dir, ".gradle"));
  copy.add(joinRel(dir, "build"));
  // Common app module build output
  if (exists(repoRoot, joinRel(dir, "app/build"))) {
    copy.add(joinRel(dir, "app/build"));
  }
}

function isFlutterProject(repoRoot: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "pubspec.yaml"), "utf8");

    // A pubspec is Flutter when it declares a `flutter` dependency or SDK constraint.
    return /^\s*flutter\s*:/m.test(raw) || /sdk:\s*flutter/m.test(raw);
  } catch {
    return false;
  }
}

function detectFlutter(ctx: DetectionContext): void {
  const { repoRoot, signals, platforms, copy, setupCommands, run } = ctx;
  signals.push({
    label: "Flutter",
    detail: "pubspec.yaml",
    kind: "framework",
  });

  // Flutter generates platform subdirs — mark each platform that is present.
  const flutterPlatformDirs: { dir: string; platform: Platform }[] = [
    { dir: "ios", platform: "ios" },
    { dir: "android", platform: "android" },
    { dir: "web", platform: "web" },
  ];
  for (const { dir, platform } of flutterPlatformDirs) {
    if (exists(repoRoot, dir)) {
      platforms.add(platform);
    }
  }

  copy.add(".dart_tool");
  if (exists(repoRoot, "build")) {
    copy.add("build");
  }
  setupCommands.push("flutter pub get");

  // Cocoapods is used by Flutter's iOS target too.
  if (exists(repoRoot, "ios/Podfile")) {
    setupCommands.push("cd ios && pod install");
    copy.add("ios/Pods");
    signals.push({ label: "CocoaPods", detail: "ios/Podfile", kind: "native" });
  }

  if (!run.find((r) => r.title === "Flutter")) {
    run.push({
      title: "Flutter",
      command: "flutter run",
      restartOnRerun: true,
    });
  }
}

/** Store a generated config as the project's config on this machine. Never writes the repo. */
export function writeArgusJson(
  repoRoot: string,
  config: Record<string, unknown>,
): void {
  saveProjectConfig(repoRoot, config, Object.keys(config));
}

/** The project's effective config, or null when neither the repo nor this machine has one. */
export function readExistingArgusJson(
  repoRoot: string,
): Record<string, unknown> | null {
  try {
    const project = getProjectConfig(repoRoot);

    return project.repo_file || project.host_keys.length > 0
      ? project.config
      : null;
  } catch {
    return null;
  }
}
