/**
 * Turning a failed proposal start into something a card can show. Git and
 * setup errors arrive as a whole terminal transcript — progress counters,
 * "Preparing worktree", tool banners — around the one line that matters.
 */

const MAX_LENGTH = 280;

/** Lines that are progress or preamble, never the reason it failed. */
const NOISE = [
  /^Preparing worktree/,
  /^Updating files:/,
  /^HEAD is now at/,
  /^Run with --verbose/i,
  /^mise ERROR Version:/,
  /^mise ERROR Run with/,
  /^See https?:\/\//,
];

function messageOf(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  return error instanceof Error ? error.message : String(error);
}

export function readableStartError(error: unknown): string {
  const lines = messageOf(error)
    // `git` redraws its progress with carriage returns, all on one line.
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line && !NOISE.some((re) => re.test(line)));
  const text = [...new Set(lines)].join(" ") || "Something went wrong.";

  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}
