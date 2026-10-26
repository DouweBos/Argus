/**
 * High-level title / branch-slug generators built on top of `runClaudePrint`.
 *
 * All three helpers share the same CLI invocation, timeout, and failure
 * broadcast pipeline — only the prompt and the parsing differ.
 */

import { tmpdir } from "node:os";
import { runClaudePrint } from "./oneShot";

/** Openings of these prompts; the CLI chat importer skips transcripts that start with them. */
export const SESSION_TITLE_PROMPT =
  "Generate a concise 3-5 word title for a coding session.";
export const BRANCH_AND_TITLE_PROMPT =
  "Given a developer's description of a coding task, produce a short git branch name";
export const CHAT_TITLE_PROMPT =
  "Produce a title (3-6 words, no trailing punctuation, no quotes, title case)";

const MAX_TITLE_CHARS = 60;
const MAX_CHAT_TITLE_CHARS = 80;
const MAX_CHAT_INPUT_CHARS = 2000;

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
  const words = tail.replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return branch;
  }

  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Produce a 3-5 word session title from a branch + optional description.
 * Returns null on any failure.
 */
export async function generateSessionTitle(
  opts: GenerateOptions,
): Promise<string | null> {
  const desc = (opts.description ?? "").trim() || "none";
  const prompt = `${SESSION_TITLE_PROMPT} Respond with only the title, no punctuation, no quotes. Branch: ${opts.branch}. Description: ${desc}.`;

  const result = await runClaudePrint({
    prompt,
    cwd: opts.repoRoot,
    source: "session_title",
  });

  return result ? normaliseTitle(result, MAX_TITLE_CHARS) : null;
}

interface BranchAndTitle {
  branch: string;
  title: string;
}

/**
 * Generate a branch-name slug + 3-5 word title from a user-authored prompt.
 * Returns null on any failure — callers should fall back to slugging the
 * prompt directly.
 */
export async function generateBranchAndTitle(
  prompt: string,
  repoRoot?: string,
): Promise<BranchAndTitle | null> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return null;
  }
  const instruction =
    `${BRANCH_AND_TITLE_PROMPT} and a 3-5 word session title. ` +
    `Reply with ONLY a JSON object like {"branch":"kebab-case-branch","title":"Short Title Here"}. ` +
    `The branch must be lowercase kebab-case, max 40 chars, no slashes. ` +
    `The title must be 3-5 words, title-cased, no trailing punctuation. ` +
    `Task: ${trimmed}`;

  const result = await runClaudePrint({
    prompt: instruction,
    cwd: repoRoot,
    source: "session_title",
  });
  if (!result) {
    return null;
  }

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }
  let obj: Partial<BranchAndTitle>;
  try {
    obj = JSON.parse(jsonMatch[0]) as Partial<BranchAndTitle>;
  } catch {
    return null;
  }
  const branch = normaliseBranchSlug(obj.branch ?? "");
  const title = normaliseTitle(obj.title ?? "", MAX_TITLE_CHARS) ?? "";
  if (!branch || !title) {
    return null;
  }

  return { branch, title };
}

/**
 * Generate a short human-readable title summarising a chat from its first
 * user message. Returns null on any failure.
 */
export async function generateChatTitle(
  firstMessage: string,
): Promise<string | null> {
  const trimmed = firstMessage.trim();
  if (!trimmed) {
    return null;
  }

  const snippet =
    trimmed.length > MAX_CHAT_INPUT_CHARS
      ? trimmed.slice(0, MAX_CHAT_INPUT_CHARS)
      : trimmed;

  const prompt = `${CHAT_TITLE_PROMPT} that summarises this chat's topic based on the user's first message. Respond with ONLY the title text, nothing else.\n\nUser message:\n${snippet}`;

  const result = await runClaudePrint({
    prompt,
    cwd: tmpdir(),
    source: "chat_title",
  });

  return result ? normaliseTitle(result, MAX_CHAT_TITLE_CHARS) : null;
}

function normaliseBranchSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_/]+|[-_/]+$/g, "");
  if (!slug) {
    return "";
  }

  return slug.length > 40 ? slug.slice(0, 40).replace(/-+$/, "") : slug;
}

function normaliseTitle(raw: string, maxChars: number): string | null {
  let title = raw.trim();
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1).trim();
  }
  title = title
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();

  if (!title) {
    return null;
  }

  if (title.length > maxChars) {
    title = title.slice(0, maxChars - 1).trimEnd() + "…";
  }

  return title;
}
