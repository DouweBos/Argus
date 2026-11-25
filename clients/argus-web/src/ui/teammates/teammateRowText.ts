import type { TeammateSummary } from "@argus/remote-protocol";

/** The inbox row's second line: what it is doing, else the conversation touched last, else who it is. */
export function teammatePreview(summary: TeammateSummary): string {
  if (summary.working) {
    return "Working on a duty";
  }
  const title = summary.latest_thread?.title.trim();
  if (title) {
    return title;
  }

  return summary.teammate.tagline.trim() || "No conversations yet";
}

/** When it last did anything: a duty ran or a conversation was opened. */
export function teammateLastActivityAt(summary: TeammateSummary): number | null {
  const times = [summary.last_run_at, summary.latest_thread?.last_opened_at].filter(
    (t): t is number => typeof t === "number",
  );

  return times.length ? Math.max(...times) : null;
}
