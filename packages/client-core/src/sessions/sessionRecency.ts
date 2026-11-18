/**
 * Newest message first. Port of ArgusCore's `SessionRecency`: a compare run
 * sorts by its newest slot and a stack by its newest session, so each stays
 * together; sessions with no message keep their order, last.
 */

import type { RemoteSession } from "@argus/remote-protocol";

type Session = Pick<
  RemoteSession,
  "compare_group" | "id" | "last_message_at" | "parent_session_id"
>;

export function sortSessionsByRecency<T extends Session>(sessions: T[]): T[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  // A run, else the bottom of its stack in this list, else itself.
  const unit = (s: Session): string => {
    if (s.compare_group) {
      return `run:${s.compare_group.id}`;
    }
    let current = s;
    const seen = new Set([s.id]);
    for (;;) {
      const parent = current.parent_session_id
        ? byId.get(current.parent_session_id)
        : undefined;
      if (!parent || seen.has(parent.id)) {
        return current.id;
      }
      seen.add(parent.id);
      current = parent;
    }
  };
  const units = sessions.map(unit);
  const newest = new Map<string, number>();
  const first = new Map<string, number>();
  units.forEach((key, i) => {
    if (!first.has(key)) {
      first.set(key, i);
    }
    const at = sessions[i]!.last_message_at;
    if (at != null) {
      newest.set(key, Math.max(newest.get(key) ?? at, at));
    }
  });

  return sessions
    .map((_, i) => i)
    .sort((a, b) => {
      const [ua, ub] = [units[a]!, units[b]!];
      const [x, y] = [newest.get(ua), newest.get(ub)];
      if (x !== undefined && y !== undefined && x !== y) {
        return y - x;
      }
      if (x !== undefined && y === undefined) {
        return -1;
      }
      if (x === undefined && y !== undefined) {
        return 1;
      }

      return first.get(ua)! - first.get(ub)! || a - b;
    })
    .map((i) => sessions[i]!);
}
