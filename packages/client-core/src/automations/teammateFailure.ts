import type {
  TeammateThreadFailure,
  TeammateThreadFailureKind,
} from "@argus/remote-protocol";

const TITLES: Partial<Record<TeammateThreadFailureKind, string>> = {
  limit: "Stopped at the usage limit",
  auth: "Stopped: the account needs signing in",
  crashed: "The agent quit mid-turn",
  interrupted: "Interrupted by a restart",
};

/** A stopped teammate conversation's headline, by why it stopped. */
export function threadFailureTitle(kind: TeammateThreadFailureKind): string {
  return TITLES[kind] ?? "Stopped with an error";
}

/** "at 14:05", or "Tue at 14:05" when it isn't today. */
export function clockTimeLabel(at: number, now: Date = new Date()): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const sameDay = when.toDateString() === now.toDateString();
  const day = sameDay
    ? ""
    : `${when.toLocaleDateString(undefined, { weekday: "short" })} `;

  return `${day}at ${time}`;
}

/** The failure's reason, plus when a spent limit resets. */
export function threadFailureDetail(
  failure: TeammateThreadFailure,
  now: Date = new Date(),
): string {
  if (failure.resets_at === null) {
    return failure.reason;
  }

  return `${failure.reason} It resets ${clockTimeLabel(failure.resets_at, now)}.`;
}
