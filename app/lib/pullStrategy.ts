import type { PullStrategy } from "@argus/peacock";

const OFF = new Set(["", "false", "no", "off", "0"]);

/** What `git pull` does under these `pull.ff` / `pull.rebase` values: merge when neither is set. */
export function pullStrategyFromConfig(
  rebase: string | null,
  ff: string | null,
): PullStrategy {
  if (ff?.trim().toLowerCase() === "only") {
    return "ff-only";
  }

  return OFF.has(rebase?.trim().toLowerCase() ?? "") ? "merge" : "rebase";
}
