/**
 * Inference + write support for generating `.argus.json` during onboarding.
 * Never auto-commits — only writes to the repo root. If a file already exists,
 * callers must decide whether to back up with `.argus.json.bak`.
 */

import type { ArgusConfigSuggestion, DetectedSignal } from "./types";
import fs from "node:fs";
import path from "node:path";

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

type Platform = "android" | "ios" | "web";

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

function firstMatchingDir(repoRoot: string, candidates: string[]): string | null {
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
  const signals: DetectedSignal[] = [];
  const inferred: string[] = [];

  const pkg = readPackageJson(repoRoot);
  if (!pkg) {
    return {
      config: {
        setup: { copy: [], symlink: [], commands: [] },
        terminals: [{ name: "Shell", dir: "." }],
        run: [],
        workspace_env: [],
        protected_branches: ["main", "master"],
      },
      inferredFrom: [],
      signals: [],
    };
  }
  signals.push({
    label: "package.json",
    detail: pkg.name ?? "Node project",
    kind: "project",
  });
  inferred.push("package.json");

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};
  const platforms = new Set<Platform>();
  const run: { title: string; command: string; restartOnRerun: boolean }[] = [];
  const copy = new Set<string>();
  const workspaceEnv: {
    name: string;
    base_value: number;
    range: number;
    strategy: "hash" | "sequential";
  }[] = [];
  let browserUrl: string | null = null;

  // Framework detection ---------------------------------------------------
  if (deps.expo) {
    platforms.add("ios");
    platforms.add("android");
    signals.push({ label: "Expo", detail: deps.expo, kind: "framework" });
    inferred.push("expo");
    if (scripts.start) {
      run.push({ title: "Expo", command: `${pickRunner(repoRoot)} start`, restartOnRerun: true });
    }
  } else if (deps["react-native"]) {
    platforms.add("ios");
    platforms.add("android");
    signals.push({ label: "React Native", detail: deps["react-native"], kind: "framework" });
    inferred.push("react-native");
    if (scripts.start) {
      run.push({ title: "Metro", command: `${pickRunner(repoRoot)} start`, restartOnRerun: true });
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
    workspaceEnv.push({ name: "PORT", base_value: 3000, range: 100, strategy: "sequential" });
  } else if (deps.vite || deps["@vitejs/plugin-react"]) {
    platforms.add("web");
    signals.push({ label: "Vite", detail: deps.vite ?? "react", kind: "framework" });
    inferred.push("vite");
    browserUrl = "http://localhost:5173";
    workspaceEnv.push({ name: "VITE_PORT", base_value: 5173, range: 100, strategy: "sequential" });
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
    platforms.add("ios");
    signals.push({ label: "iOS project", detail: iosDir, kind: "platform" });
    if (exists(repoRoot, path.join(iosDir, "Podfile"))) {
      signals.push({ label: "CocoaPods", detail: "Podfile", kind: "native" });
      copy.add(`${iosDir}/Pods`);
    }
    const xcworkspace = fs
      .readdirSync(path.join(repoRoot, iosDir))
      .find((n) => n.endsWith(".xcworkspace") || n.endsWith(".xcodeproj"));
    if (xcworkspace) {
      signals.push({ label: "Xcode", detail: xcworkspace, kind: "native" });
    }
  }
  const androidDir = firstMatchingDir(repoRoot, ["android", "apps/android", "mobile/android"]);
  if (androidDir) {
    platforms.add("android");
    signals.push({ label: "Android project", detail: androidDir, kind: "platform" });
    if (exists(repoRoot, path.join(androidDir, "gradlew"))) {
      signals.push({ label: "Gradle", kind: "native" });
    }
    copy.add(`${androidDir}/.gradle`);
    copy.add(`${androidDir}/build`);
  }

  // Lockfiles / package managers -----------------------------------------
  const runner = pickRunner(repoRoot);
  const setupCommands: string[] = [];
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
    signals.push({ label: "npm", detail: "package-lock.json", kind: "tooling" });
    inferred.push("package-lock.json");
  } else if (exists(repoRoot, "bun.lockb") || exists(repoRoot, "bun.lock")) {
    setupCommands.push("bun install");
    signals.push({ label: "bun", kind: "tooling" });
    inferred.push("bun.lock");
  }

  // node_modules — worth copying so the worktree is usable before `install`
  if (exists(repoRoot, "node_modules")) {
    copy.add("node_modules");
    signals.push({ label: "node_modules", detail: "will be copied", kind: "tooling" });
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
  if (pkg.workspaces) {
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
    run.push({ title: "Dev", command: `${runner} run dev`, restartOnRerun: true });
  }

  // Web workspace_env port allocation when nothing framework-specific added
  if (platforms.has("web") && workspaceEnv.length === 0) {
    workspaceEnv.push({
      name: "ARGUS_PORT",
      base_value: 3000,
      range: 100,
      strategy: "sequential",
    });
  }

  const config: Record<string, unknown> = {
    setup: {
      copy: Array.from(copy).sort(),
      symlink: [],
      commands: setupCommands,
    },
    terminals: [{ name: "Shell", dir: "." }],
    run,
    workspace_env: workspaceEnv,
    protected_branches: ["main", "master"],
  };
  if (platforms.size > 0) {
    config.platforms = Array.from(platforms).sort();
  }
  if (browserUrl) {
    config.browser_url = browserUrl;
  }

  return { config, inferredFrom: inferred, signals };
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

/** Write `.argus.json` to the repo root. Does NOT commit. */
export function writeArgusJson(
  repoRoot: string,
  config: Record<string, unknown>,
): void {
  const configPath = path.join(repoRoot, ".argus.json");
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, `${configPath}.bak`);
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

export function readExistingArgusJson(
  repoRoot: string,
): Record<string, unknown> | null {
  const configPath = path.join(repoRoot, ".argus.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");

    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
