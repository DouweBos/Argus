/**
 * Claude-style deny patterns (`Bash(git push:*)`, `Edit`) checked against a
 * Codex approval request. Codex has no deny list of its own, so the runner
 * refuses these before anyone is asked.
 */

export function matchesDisallowed(
  patterns: string[],
  toolName: string,
  command: string | null,
): boolean {
  for (const pattern of patterns) {
    const m = /^(\w+)\((.*)\)$/.exec(pattern);
    if (!m) {
      if (pattern === toolName) {
        return true;
      }
      continue;
    }
    if (m[1] !== toolName || command === null) {
      continue;
    }
    const prefix = m[2]!.replace(/:?\*$/, "");
    if (command.trim().startsWith(prefix)) {
      return true;
    }
  }

  return false;
}
