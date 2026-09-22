import { useState } from "react";

/**
 * How many items have arrived since the reader last had the view open.
 *
 * Counted rather than flagged: "3" tells someone looking at a device whether
 * it's worth switching panes, where a dot doesn't. Reading is defined as having
 * the view open, so anything arriving while they watch is already read.
 *
 * Derived during render rather than in an effect — an effect would paint the
 * badge one frame stale, and React supports adjusting state this way.
 */
export function useUnreadCount(total: number, open: boolean): number {
  const [seen, setSeen] = useState(total);
  const [previous, setPrevious] = useState(total);

  if (total !== previous) {
    setPrevious(total);
  }
  // A shrinking list is a new log — a huddle ended and another began, or the
  // backlog was handed over again — not items having been read.
  if ((open || total < previous) && seen !== total) {
    setSeen(total);
  }

  return open ? 0 : Math.max(0, total - seen);
}
