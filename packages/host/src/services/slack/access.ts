/**
 * Who may drive agents from Slack. Treated like the Control grant: nobody
 * until the owner claims the bot with the code the Mac shows, then the owner
 * plus whoever the allowlist names.
 */

import type { SlackConfig } from "./store";

export function isAllowed(config: SlackConfig, userId: string): boolean {
  if (!userId) {
    return false;
  }

  return (
    config.owner?.user_id === userId ||
    config.allowedUsers.some((u) => u.user_id === userId)
  );
}

/** The DM text claims the bot when it is exactly the pending code. */
export function claimAttempt(
  config: SlackConfig,
  text: string,
): "claimed" | "none" | "wrong" {
  if (config.owner || !config.claimCode) {
    return "none";
  }
  const words = text.trim().split(/\s+/);
  let code: string | undefined;
  if (words.length === 2 && /^claim$/i.test(words[0]!)) {
    code = words[1];
  } else if (words.length === 1) {
    code = words[0];
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return "none";
  }

  return code === config.claimCode ? "claimed" : "wrong";
}

/** Rotate the code after this many wrong guesses, so it can't be walked. */
export const MAX_CLAIM_ATTEMPTS = 5;

export const REFUSAL =
  "Sorry, I only take requests from people the owner of this Argus allowed. Ask them to add you in Argus → Settings → Integrations → Slack.";

export const UNCLAIMED =
  "This Argus bot isn't claimed yet. Its owner can claim it by sending me the code shown in Argus → Settings → Integrations → Slack.";
