/**
 * One-shot session title generation via the Claude Code CLI.
 *
 * Spawns `claude -p --model haiku --output-format json <prompt>` as a short-
 * lived child process. Uses the user's existing Claude Code auth (no API
 * key required) and exits after one response. Returns the trimmed result.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { warn } from "../../../app/lib/logger";

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = "claude";
const TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARS = 2000;
const MAX_TITLE_CHARS = 80;

interface PrintResult {
  result?: string;
  is_error?: boolean;
}

/**
 * Generate a short human-readable title from the first user message.
 * Returns null on any failure (caller should fall back to a derived title).
 */
export async function generateSessionTitle(
  firstMessage: string,
): Promise<string | null> {
  const trimmed = firstMessage.trim();
  if (!trimmed) {
    return null;
  }

  const snippet =
    trimmed.length > MAX_INPUT_CHARS
      ? trimmed.slice(0, MAX_INPUT_CHARS)
      : trimmed;

  const prompt =
    `Produce a title (3-6 words, no trailing punctuation, no quotes, title case) that summarises this chat's topic based on the user's first message. Respond with ONLY the title text, nothing else.\n\nUser message:\n${snippet}`;

  try {
    const { stdout } = await execFileAsync(
      CLAUDE_BIN,
      ["-p", "--model", "haiku", "--output-format", "json", prompt],
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
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

  // Strip surrounding quotes if Claude wrapped the title.
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1).trim();
  }

  // Collapse whitespace — single line, no newlines.
  title = title.replace(/\s+/g, " ");

  if (!title) {
    return null;
  }

  if (title.length > MAX_TITLE_CHARS) {
    title = title.slice(0, MAX_TITLE_CHARS - 1).trimEnd() + "\u2026";
  }

  return title;
}
