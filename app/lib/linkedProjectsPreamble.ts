/**
 * Linked projects are surfaced to the agent by prepending a structured
 * preamble to the user's message. We render those paths as project chips in
 * the chat bubble (instead of leaking the raw bracket text), which means we
 * need a stable build/parse pair shared between sender and renderer.
 */

const PREAMBLE_HEAD =
  "[Linked project directories — the user has explicitly attached the following project roots to this chat. You are allowed and expected to read from and make changes in these directories in addition to your own worktree:";

export function buildLinkedProjectsPreamble(
  linkedProjects: readonly string[],
  baseMessage: string,
): string {
  if (linkedProjects.length === 0) {
    return baseMessage;
  }
  const lines = linkedProjects.map((p) => `- ${p}`).join("\n");

  return `${PREAMBLE_HEAD}\n${lines}]\n\n${baseMessage}`;
}

export interface ParsedLinkedProjectsPreamble {
  paths: string[];
  rest: string;
}

/**
 * Detect and strip the linked-projects preamble from a user message.
 * Returns null when the text does not start with the preamble.
 */
export function parseLinkedProjectsPreamble(
  text: string,
): ParsedLinkedProjectsPreamble | null {
  if (!text.startsWith(PREAMBLE_HEAD)) {
    return null;
  }
  const afterHead = text.slice(PREAMBLE_HEAD.length);
  // The preamble closes with `]` at the end of the final path line, then a
  // blank line separates it from the rest of the message.
  const closeIdx = afterHead.indexOf("]");
  if (closeIdx === -1) {
    return null;
  }
  const block = afterHead.slice(0, closeIdx);
  const paths: string[] = [];
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      paths.push(trimmed.slice(2).trim());
    }
  }
  if (paths.length === 0) {
    return null;
  }
  const rest = afterHead.slice(closeIdx + 1).replace(/^\n+/, "");

  return { paths, rest };
}
