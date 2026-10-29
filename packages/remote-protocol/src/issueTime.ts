/** How long an issue spent in each status, from its status history. */

export interface StatusStint {
  name: string;
  type: string;
  /** Milliseconds, summed over every time it was in that status. */
  duration: number;
}

/** Statuses in the order first entered, each with its total time. */
export function timeInStatus(
  history: { name: string; type: string; enteredAt: number }[],
  now = Date.now(),
): StatusStint[] {
  const totals = new Map<string, StatusStint>();
  history.forEach((entry, i) => {
    const end = history[i + 1]?.enteredAt ?? now;
    const stint = totals.get(entry.name) ?? {
      name: entry.name,
      type: entry.type,
      duration: 0,
    };
    stint.duration += Math.max(0, end - entry.enteredAt);
    totals.set(entry.name, stint);
  });

  return [...totals.values()];
}

const UNITS: [number, string][] = [
  [365 * 86_400_000, "y"],
  [30 * 86_400_000, "mo"],
  [7 * 86_400_000, "w"],
  [86_400_000, "d"],
  [3_600_000, "h"],
  [60_000, "m"],
];

/** "10mo", "5d" — Linear's short durations. */
export function shortDuration(ms: number): string {
  for (const [size, unit] of UNITS) {
    if (ms >= size) {
      return `${Math.floor(ms / size)}${unit}`;
    }
  }

  return "<1m";
}
