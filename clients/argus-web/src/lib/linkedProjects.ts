/**
 * Linked projects are surfaced to the agent by prepending a structured preamble
 * to the user's message (mirrors the desktop's `linkedProjectsPreamble`, kept
 * byte-identical so the desktop renders the same project chips).
 */

const PREAMBLE_HEAD =
  "[Linked project directories — the user has explicitly attached the following project roots to this chat. You are allowed to read from and make changes in these directories in addition to your own worktree, but you MUST NOT switch branches, check out other refs, or otherwise alter the git state of these roots — they are shared with the user's other work. If you need to silo changes on a separate branch in one of these projects, use the Argus MCP `create_session` (or `spawn_agent`) tool to open a new session in that project instead of switching branches here:";

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
  /** The message the user actually typed. */
  rest: string;
}

/**
 * Split a stored message back into its linked projects and the typed text, so
 * an edit can rebuild the preamble instead of silently dropping the links.
 * Mirrors the desktop's parser.
 */
export function parseLinkedProjectsPreamble(
  text: string,
): ParsedLinkedProjectsPreamble | null {
  if (!text.startsWith(PREAMBLE_HEAD)) {
    return null;
  }
  const afterHead = text.slice(PREAMBLE_HEAD.length);
  const closeIdx = afterHead.indexOf("]");
  if (closeIdx === -1) {
    return null;
  }
  const paths: string[] = [];
  for (const line of afterHead.slice(0, closeIdx).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      paths.push(trimmed.slice(2).trim());
    }
  }
  if (paths.length === 0) {
    return null;
  }

  return { paths, rest: afterHead.slice(closeIdx + 1).replace(/^\n+/, "") };
}
