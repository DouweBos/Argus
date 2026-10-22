/**
 * Follow-up suggestions: the replies a user is likely to send next, read off
 * the agent's last message by a small model once a turn ends.
 */

import { tmpdir } from "node:os";
import { runClaudePrint } from "./oneShot";

const MAX_INPUT_CHARS = 6000;
const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_CHARS = 120;

const SYSTEM_PROMPT =
  "You read the last message a coding agent sent its user and suggest what the user is most likely to reply. Reply with only a JSON array of strings, no tools, no explanation.";

/**
 * Up to three short replies the user might send next, or `[]` when the
 * message offers nothing to follow up on. Null on any failure.
 */
export async function generateFollowUps(
  finalMessage: string,
): Promise<string[] | null> {
  const trimmed = finalMessage.trim();
  if (!trimmed) {
    return [];
  }
  // The end of a long message is where the agent asks or offers what's next.
  const snippet =
    trimmed.length > MAX_INPUT_CHARS
      ? trimmed.slice(trimmed.length - MAX_INPUT_CHARS)
      : trimmed;

  const prompt =
    `Here is the final message a coding agent sent after finishing its turn. ` +
    `If it asks the user a question, offers options, or proposes next steps, ` +
    `write up to ${MAX_SUGGESTIONS} replies the user could send next, each a short imperative instruction ` +
    `written as the user (e.g. "Yes, add the tests", "Commit it"). ` +
    `If the message suggests no follow-up, reply with []. ` +
    `Reply with ONLY a JSON array of strings.\n\nAgent message:\n${snippet}`;

  const result = await runClaudePrint({
    prompt,
    cwd: tmpdir(),
    source: "follow_ups",
    systemPrompt: SYSTEM_PROMPT,
    // A failure here is cosmetic; it must not raise a banner on every turn.
    quiet: true,
  });

  return result === null ? null : parseFollowUps(result);
}

/** The suggestions in a model reply: deduplicated, trimmed, capped. */
export function parseFollowUps(raw: string): string[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") {
      continue;
    }
    const text = item.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || text.length > MAX_SUGGESTION_CHARS || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(text);
    if (out.length === MAX_SUGGESTIONS) {
      break;
    }
  }

  return out;
}
