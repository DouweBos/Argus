/**
 * Inference + write support for generating `.argus.json` during onboarding.
 * Never auto-commits — only writes to the repo root. If a file already exists,
 * callers must decide whether to back up with `.argus.json.bak`.
 */

import type { ArgusConfigSuggestion } from "./types";
import fs from "node:fs";
import path from "node:path";

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
}

/**
 * Infer an `.argus.json` from a project by looking at package.json scripts
 * and dependencies. Detects Expo, RN CLI, Next.js, Vite and generic Node.
 */
export function suggestArgusJson(repoRoot: string): ArgusConfigSuggestion {
  const inferred: string[] = [];
  const config: Record<string, unknown> = {};
  const pkgPath = path.join(repoRoot, "package.json");

  let pkg: PackageJsonShape = {};
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    pkg = JSON.parse(raw) as PackageJsonShape;
    inferred.push("package.json");
  } catch {
    // No package.json — return minimal config.
    return { config: {}, inferredFrom: [] };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};

  const platforms: string[] = [];

  if (deps.expo) {
    platforms.push("ios", "android");
    config.run = scripts.start ?? "npx expo start";
    inferred.push("expo");
  } else if (deps["react-native"]) {
    platforms.push("ios", "android");
    config.run = scripts.start ?? "npx react-native start";
    inferred.push("react-native");
  } else if (deps.next) {
    platforms.push("web");
    config.run = scripts.dev ?? "npm run dev";
    config.browser_url = "http://localhost:3000";
    inferred.push("next.js");
  } else if (deps.vite || deps["@vitejs/plugin-react"]) {
    platforms.push("web");
    config.run = scripts.dev ?? "npm run dev";
    config.browser_url = "http://localhost:5173";
    inferred.push("vite");
  } else if (scripts.dev || scripts.start) {
    platforms.push("web");
    config.run = scripts.dev ?? scripts.start;
    inferred.push(scripts.dev ? "scripts.dev" : "scripts.start");
  }

  if (platforms.length > 0) {
    config.platforms = platforms;
  }

  // Setup commands
  const setupCommands: string[] = [];
  if (fs.existsSync(path.join(repoRoot, "pnpm-lock.yaml"))) {
    setupCommands.push("pnpm install");
    inferred.push("pnpm-lock.yaml");
  } else if (fs.existsSync(path.join(repoRoot, "yarn.lock"))) {
    setupCommands.push("yarn install");
    inferred.push("yarn.lock");
  } else if (fs.existsSync(path.join(repoRoot, "package-lock.json"))) {
    setupCommands.push("npm install");
    inferred.push("package-lock.json");
  }
  if (setupCommands.length > 0) {
    config.setup = { commands: setupCommands };
  }

  return { config, inferredFrom: inferred };
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
