/** How an account computer's presence reads in every host list. */

export interface PresenceInfo {
  last_seen: number | null;
  online: boolean;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "Online", "Offline", or "Offline · last seen 2 hours ago" — as on the phone and the Mac app. */
export function presenceLabel(
  presence: PresenceInfo,
  now: number = Date.now(),
): string {
  if (presence.online) {
    return "Online";
  }
  if (presence.last_seen === null) {
    return "Offline";
  }
  const ago = Math.max(0, now - presence.last_seen);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const [unit, ms] = UNITS.find(([, size]) => ago >= size) ?? [
    "minute",
    60_000,
  ];

  return `Offline · last seen ${format.format(-Math.round(ago / ms), unit)}`;
}
