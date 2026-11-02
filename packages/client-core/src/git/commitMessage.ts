/**
 * A commit message as a summary over a description, the way the Mac's and
 * the phone's composers edit it. Port of ArgusCore's `CommitMessage`, sharing
 * its test vectors.
 */

export interface CommitMessage {
  description: string;
  summary: string;
}

export const EMPTY_COMMIT_MESSAGE: CommitMessage = {
  summary: "",
  description: "",
};

/** Splits a full message at its first line, as git reads a subject. */
export function parseCommitMessage(message: string): CommitMessage {
  const trimmed = message.trim();
  const newline = trimmed.indexOf("\n");
  if (newline === -1) {
    return { summary: trimmed, description: "" };
  }

  return {
    summary: trimmed.slice(0, newline).trim(),
    description: trimmed.slice(newline).trim(),
  };
}

export function hasCommitDescription(message: CommitMessage): boolean {
  return message.description.trim().length > 0;
}

/** A blank summary can't be committed, whatever the description says. */
export function isCommitMessageEmpty(message: CommitMessage): boolean {
  return message.summary.trim().length === 0;
}

/** The message git gets: summary, a blank line, then the description. */
export function commitMessageText(message: CommitMessage): string {
  const summary = message.summary.trim();
  const body = message.description.trim();

  return body ? `${summary}\n\n${body}` : summary;
}

/** `Name <email>`, or null when git has neither. */
export function commitIdentityLabel(identity: {
  email: string;
  name: string;
}): string | null {
  const name = identity.name.trim();
  const email = identity.email.trim();
  if (name && email) {
    return `${name} <${email}>`;
  }

  return name || email || null;
}
