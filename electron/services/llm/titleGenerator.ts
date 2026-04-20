/**
 * Generate a short session title from branch + description using the Claude
 * Code CLI. Fire-and-forget: callers invoke this after creating a session
 * and update the row if a title comes back. Returns null on any failure, so
 * the caller keeps whatever placeholder it already set.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { warn } from "../../../app/lib/logger";

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = "claude";
const TIMEOUT_MS = 10_000;
const MAX_TITLE_CHARS = 60;

interface PrintResult {
  result?: string;
  is_error?: boolean;
}

interface GenerateOptions {
  branch: string;
  description?: string;
  repoRoot?: string;
}

/**
 * Humanize a branch name into a fallback title: split on `/`, take the last
 * segment, replace `-`/`_` with spaces, title-case each word.
 */
export function humanizeBranchName(branch: string): string {
  const segments = branch.split("/").filter(Boolean);
  const tail = segments[segments.length - 1] ?? branch;
  const words = tail
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return branch;
  }

  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Spawn `claude -p` to produce a 3-5 word session title. Returns null on
 * timeout, missing binary, non-zero exit, parse failure, or empty output.
 */
export async function generateSessionTitle(
  opts: GenerateOptions,
): Promise<string | null> {
  const desc = (opts.description ?? "").trim() || "none";
  const prompt = `Generate a concise 3-5 word title for a coding session. Respond with only the title, no punctuation, no quotes. Branch: ${opts.branch}. Description: ${desc}.`;

  try {
    const { stdout } = await execFileAsync(
      CLAUDE_BIN,
      ["-p", "--model", "haiku", "--output-format", "json", prompt],
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        cwd: opts.repoRoot,
      },
    );

    const parsed = JSON.parse(stdout) as PrintResult;
    if (parsed.is_error || !parsed.result) {
      return null;
    }

    return normaliseTitle(parsed.result);
  } catch (e) {
    warn("generateSessionTitle failed:", e);

    return null;
  }
}

function normaliseTitle(raw: string): string | null {
  let title = raw.trim();
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1).trim();
  }
  title = title.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();

  if (!title) {
    return null;
  }

  if (title.length > MAX_TITLE_CHARS) {
    title = title.slice(0, MAX_TITLE_CHARS - 1).trimEnd() + "\u2026";
  }

  return title;
}
