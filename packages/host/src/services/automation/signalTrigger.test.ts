import type { SignalTrigger, SignalWatchState } from "./signalTrigger";
import type { SignalEvent, SignalEventKind, WorkItem } from "../signals/types";
import { describe, expect, it } from "vitest";
import {
  assertValidEventTrigger,
  decideSignalEvents,
  FORGET_AFTER_MS,
  matchingEvents,
  normalizeSignalKinds,
  normalizeSignalLabels,
} from "./signalTrigger";

function item(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    source_id: "github",
    external_id: id,
    url: "",
    title: id,
    body: "",
    state: "open",
    assignee: null,
    labels: [],
    priority: null,
    updated_at: 0,
    kind: "issue",
    repo_root: null,
    ...over,
  };
}

function event(
  id: string,
  kind: SignalEventKind = "new_issue",
  over: Partial<WorkItem> = {},
): SignalEvent {
  return { kind, key: `${kind}:${id}`, item: item(id, over), detail: {} };
}

function trigger(over: Partial<SignalTrigger> = {}): SignalTrigger {
  return {
    kind: "signal",
    on: ["new_issue"],
    labels: [],
    fire: "each",
    max_runs_per_hour: 4,
    ...over,
  };
}

const NOW = 10 * FORGET_AFTER_MS;

function decide(previous: SignalWatchState | null, matching: SignalEvent[]) {
  return decideSignalEvents({ key: "k", previous, matching, now: NOW });
}

describe("matchingEvents", () => {
  it("keeps only the kinds the trigger is on", () => {
    const got = matchingEvents(
      [event("a", "new_issue"), event("b", "ci_failed")],
      trigger({ on: ["ci_failed"] }),
      [],
    );
    expect(got.map((e) => e.item.external_id)).toEqual(["b"]);
  });

  it("filters on any label, case-insensitively", () => {
    const got = matchingEvents(
      [
        event("a", "new_issue", { labels: ["Bug"] }),
        event("b", "new_issue", { labels: ["docs"] }),
      ],
      trigger({ labels: ["bug"] }),
      [],
    );
    expect(got.map((e) => e.item.external_id)).toEqual(["a"]);
  });

  it("drops items mapped outside the scope but keeps unmapped ones", () => {
    const got = matchingEvents(
      [
        event("in", "new_issue", { repo_root: "/r/a" }),
        event("out", "new_issue", { repo_root: "/r/b" }),
        event("none"),
      ],
      trigger(),
      ["/r/a"],
    );
    expect(got.map((e) => e.item.external_id)).toEqual(["in", "none"]);
  });
});

describe("decideSignalEvents", () => {
  it("baselines on the first poll instead of firing on the backlog", () => {
    const d = decide(null, [event("a"), event("b")]);
    expect(d).toMatchObject({ baseline: true, fresh: [] });
    expect(Object.keys(d.state.seen)).toEqual(["new_issue:a", "new_issue:b"]);
  });

  it("rebaselines when the filter changed", () => {
    expect(decide({ key: "old", seen: {} }, [event("a")]).baseline).toBe(true);
  });

  it("returns only unseen events, oldest first", () => {
    const d = decide({ key: "k", seen: { "new_issue:a": NOW } }, [
      event("a"),
      event("c", "new_issue", { updated_at: 5 }),
      event("b", "new_issue", { updated_at: 1 }),
    ]);
    expect(d.fresh.map((e) => e.item.external_id)).toEqual(["b", "c"]);
  });

  it("keeps a key through a short gap, so a source blinking out doesn't refire", () => {
    const gone = decide({ key: "k", seen: { "new_issue:a": NOW - 1000 } }, []);
    expect(decide(gone.state, [event("a")]).fresh).toEqual([]);
  });

  it("fires again once a key has been gone long enough", () => {
    const old = { key: "k", seen: { "assigned:a": NOW - FORGET_AFTER_MS } };
    expect(decide(old, [event("a", "assigned")]).fresh).toHaveLength(1);
  });
});

describe("validation", () => {
  it("rejects a cap outside 1..60 and an empty event list", () => {
    expect(() =>
      assertValidEventTrigger(trigger({ max_runs_per_hour: 0 })),
    ).toThrow();
    expect(() =>
      assertValidEventTrigger(trigger({ max_runs_per_hour: 61 })),
    ).toThrow();
    expect(() => assertValidEventTrigger(trigger({ on: [] }))).toThrow();
    expect(() => assertValidEventTrigger(trigger())).not.toThrow();
    expect(() =>
      assertValidEventTrigger({
        kind: "webhook",
        fire: "batch",
        max_runs_per_hour: 2,
      }),
    ).not.toThrow();
  });

  it("normalizes labels and kinds", () => {
    expect(normalizeSignalLabels([" bug", "Bug", "", "ci "])).toEqual([
      "bug",
      "ci",
    ]);
    expect(normalizeSignalKinds(["mentioned", "nope", "new_issue"])).toEqual([
      "new_issue",
      "mentioned",
    ]);
  });
});
