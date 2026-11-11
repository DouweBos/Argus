/** Where a slash command's argument leads: an issue in the app, a URL, or nowhere. */
export type CommandArgumentTarget =
  | { kind: "issue"; identifier: string }
  | { kind: "url"; href: string }
  | null;

const ISSUE_ID = /^[A-Z][A-Z0-9]*-\d+$/;
const LINEAR_ISSUE_URL =
  /^https?:\/\/(?:www\.)?linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:[/?#]|$)/i;

export function commandArgumentTarget(argument: string): CommandArgumentTarget {
  const value = argument.trim();
  if (ISSUE_ID.test(value)) {
    return { kind: "issue", identifier: value };
  }
  const linear = LINEAR_ISSUE_URL.exec(value);
  if (linear) {
    return { kind: "issue", identifier: linear[1].toUpperCase() };
  }
  if (/^https?:\/\/\S+$/i.test(value)) {
    return { kind: "url", href: value };
  }

  return null;
}
