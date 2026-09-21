/**
 * Curated example projects the user can clone during onboarding.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExampleProject {
  slug: string;
  name: string;
  description: string;
  platform: "android" | "ios" | "web";
  repo: string;
}

export const EXAMPLE_PROJECTS: ExampleProject[] = [
  {
    slug: "expo-starter",
    name: "Expo Starter",
    description: "A minimal Expo React Native app.",
    platform: "ios",
    repo: "https://github.com/expo/examples.git",
  },
  {
    slug: "nextjs-starter",
    name: "Next.js Starter",
    description: "A minimal Next.js web app.",
    platform: "web",
    repo: "https://github.com/vercel/next.js.git",
  },
];

export function listExamples(): ExampleProject[] {
  return EXAMPLE_PROJECTS;
}

export async function cloneExample(slug: string): Promise<{ path: string }> {
  const example = EXAMPLE_PROJECTS.find((e) => e.slug === slug);
  if (!example) {
    throw new Error(`Unknown example: ${slug}`);
  }
  const destRoot = path.join(os.homedir(), "Projects", "argus-examples");
  fs.mkdirSync(destRoot, { recursive: true });
  const destPath = path.join(destRoot, slug);
  if (fs.existsSync(destPath)) {
    // Already cloned; reuse.
    return { path: destPath };
  }
  await execFileAsync("git", ["clone", "--depth", "1", example.repo, destPath]);

  return { path: destPath };
}
