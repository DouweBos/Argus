/**
 * Use the Claude Code CLI as a one-shot non-interactive assistant to refine
 * an inferred `.argus.json`. The CLI is assumed to be installed and authed —
 * we rely on the same binary the Preflight step already validates.
 *
 * Runs `claude --print` inside the project directory with a strict prompt
 * asking for JSON output. The caller decides what to do with the result.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { checkoutRoot } from "../../lib/checkoutRoot";

const CLAUDE_BIN = "claude";
const TIMEOUT_MS = 120_000;

let cachedSchemaDoc: string | null = null;

function loadSchemaDoc(): string {
  if (cachedSchemaDoc !== null) {
    return cachedSchemaDoc;
  }
  const docPath = hostPlatform().isPackaged()
    ? path.join(hostPlatform().resourcesPath(), "docs", "project-settings.md")
    : path.join(checkoutRoot(), "docs", "project-settings.md");
  try {
    cachedSchemaDoc = readFileSync(docPath, "utf-8");
  } catch (e) {
    cachedSchemaDoc = "";
    warn(
      `Failed to load project-settings.md for refineWithClaude: ${String(e)}`,
    );
  }

  return cachedSchemaDoc;
}

/** Opening of the prompt, for the CLI chat importer to recognise. */
export const REFINE_ARGUS_JSON_PROMPT =
  "You are helping configure an Argus project.";

export async function refineArgusJsonWithClaude(
  repoRoot: string,
  currentConfig: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const prompt = [
    `${REFINE_ARGUS_JSON_PROMPT} Argus runs Claude Code agents in isolated git worktrees for parallel mobile/web development.`,
    "",
    "Inspect the project in the current working directory — read package.json, lockfiles, ios/Podfile, android/build.gradle, pnpm-workspace.yaml, turbo.json, Makefile, .env.example, and any run scripts. Detect the package manager, frameworks (Expo, RN, Next, Vite, etc.), native targets, and dev/build commands.",
    "",
    "Produce a refined `.argus.json` for this project. Start from the inferred config below and improve it:",
    "- Add missing `setup.copy` entries (node_modules, Pods, .gradle caches, generated types, .claude) that would let a fresh worktree boot quickly.",
    "- Add `setup.symlink` entries for `.env` / `.env.local` style files if present — these should be shared, not copied.",
    "- Add `setup.commands` for install / bundle / pod install as needed.",
    "- Populate `run[]` with the real dev command (title it meaningfully).",
    "- Pick `platforms` based on the detected stack.",
    "- Add a `workspace_env` port allocation if the dev server listens on a port.",
    "- Keep it minimal: don't invent commands that aren't warranted by the project.",
    "",
    "Reference documentation for `.argus.json` (all supported fields, semantics, and examples):",
    "",
    loadSchemaDoc(),
    "",
    "Current inferred config:",
    "```json",
    JSON.stringify(currentConfig, null, 2),
    "```",
    "",
    "Output ONLY the refined JSON object. No prose, no markdown fences, no commentary. Just the JSON.",
  ].join("\n");

  const stdout = await execWithTimeout(
    CLAUDE_BIN,
    [
      "--print",
      "--no-session-persistence",
      "--permission-mode",
      "bypassPermissions",
      prompt,
    ],
    repoRoot,
  );

  return parseJsonFromOutput(stdout);
}

function execWithTimeout(
  bin: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr.toString().trim() || err.message;
          reject(new Error(`claude CLI failed: ${msg}`));

          return;
        }
        resolve(stdout.toString());
      },
    );
    // The prompt is an argument; an open stdin makes `claude --print` wait 3s
    // for piped input and report that instead of the real error.
    child.stdin?.end();
    child.on("error", (e) => reject(e));
  });
}

function parseJsonFromOutput(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Claude returned no JSON object");
  }
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `Failed to parse Claude output as JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
