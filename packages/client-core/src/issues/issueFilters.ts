/**
 * Linear-style issue filters, applied to the issues Argus already fetched.
 * A filter is a field, "is" or "is not", and the values it matches; filters
 * on different fields all have to match, values within one filter any.
 */

import type { LinearIssue } from "@argus/remote-protocol";
import { cycleLabel } from "./issueBoard";

export type FilterField =
  | "assignee"
  | "content"
  | "created"
  | "creator"
  | "cycle"
  | "due"
  | "estimate"
  | "labels"
  | "links"
  | "priority"
  | "project"
  | "relations"
  | "status"
  | "statusType"
  | "team"
  | "updated";

export interface IssueFilter {
  field: FilterField;
  /** "is not" / "exclude". */
  negate: boolean;
  /** Option values; for `content`, the text to look for. */
  values: string[];
}

export interface FilterOption {
  count: number;
  label: string;
  value: string;
}

interface FieldDef {
  /** Fixed options, in this order, before (or instead of) ones seen in the data. */
  fixed?: { label: string; value: string }[];
  /** Only the fixed options: the data adds none. */
  fixedOnly?: boolean;
  /** `text` takes free text; the rest pick from options. */
  kind: "options" | "text";
  label: string;
  labelOf?: (value: string, issues: LinearIssue[]) => string;
  /** Plural fields match when any of an issue's values is picked. */
  valuesOf: (issue: LinearIssue, now: number) => string[];
}

const NONE = "__none__";
const DAY = 24 * 60 * 60 * 1000;

const PRIORITY_NAMES: Record<string, string> = {
  "0": "No priority",
  "1": "Urgent",
  "2": "High",
  "3": "Medium",
  "4": "Low",
};

const STATUS_TYPE_NAMES: Record<string, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  canceled: "Canceled",
  duplicate: "Duplicate",
};

/** "within the last N days" buckets for a timestamp. */
function recency(epochMs: number, now: number): string[] {
  const age = now - epochMs;

  return [
    ...(age <= DAY ? ["1d"] : []),
    ...(age <= 7 * DAY ? ["7d"] : []),
    ...(age <= 30 * DAY ? ["30d"] : []),
    ...(age <= 90 * DAY ? ["90d"] : []),
  ];
}

const RECENCY = [
  { value: "1d", label: "In the last day" },
  { value: "7d", label: "In the last week" },
  { value: "30d", label: "In the last month" },
  { value: "90d", label: "In the last 3 months" },
];

function dueBuckets(due: string | null | undefined, now: number): string[] {
  if (!due) {
    return [NONE];
  }
  const at = Date.parse(`${due}T23:59:59`);
  if (at < now) {
    return ["overdue"];
  }

  return at - now <= 7 * DAY ? ["week"] : ["later"];
}

export const FILTER_FIELDS: Record<FilterField, FieldDef> = {
  team: { label: "Team", kind: "options", valuesOf: (i) => [i.teamName] },
  status: { label: "Status", kind: "options", valuesOf: (i) => [i.state.name] },
  statusType: {
    label: "Status type",
    kind: "options",
    valuesOf: (i) => [i.state.type],
    labelOf: (v) => STATUS_TYPE_NAMES[v] ?? v,
  },
  assignee: {
    label: "Assignee",
    kind: "options",
    valuesOf: (i) => [i.assignee ?? NONE],
  },
  creator: {
    label: "Creator",
    kind: "options",
    valuesOf: (i) => [i.creator ?? NONE],
  },
  priority: {
    label: "Priority",
    kind: "options",
    valuesOf: (i) => [String(i.priority)],
    fixed: ["1", "2", "3", "4", "0"].map((v) => ({
      value: v,
      label: PRIORITY_NAMES[v],
    })),
    fixedOnly: true,
  },
  estimate: {
    label: "Estimate",
    kind: "options",
    valuesOf: (i) => [i.estimate == null ? NONE : String(i.estimate)],
    labelOf: (v) => `${v} pt`,
  },
  labels: {
    label: "Labels",
    kind: "options",
    valuesOf: (i) => (i.labels.length > 0 ? i.labels : [NONE]),
  },
  relations: {
    label: "Relations",
    kind: "options",
    valuesOf: (i) => [i.parent ? "sub" : "top"],
    fixed: [
      { value: "sub", label: "Is a sub-issue" },
      { value: "top", label: "Isn't a sub-issue" },
    ],
    fixedOnly: true,
  },
  created: {
    label: "Created",
    kind: "options",
    valuesOf: (i, now) => recency(i.createdAt, now),
    fixed: RECENCY,
    fixedOnly: true,
  },
  updated: {
    label: "Updated",
    kind: "options",
    valuesOf: (i, now) => recency(i.updatedAt, now),
    fixed: RECENCY,
    fixedOnly: true,
  },
  due: {
    label: "Due date",
    kind: "options",
    valuesOf: (i, now) => dueBuckets(i.dueDate, now),
    fixed: [
      { value: "overdue", label: "Overdue" },
      { value: "week", label: "Due in the next week" },
      { value: "later", label: "Due later" },
    ],
  },
  project: {
    label: "Project",
    kind: "options",
    valuesOf: (i) => [i.project?.name ?? NONE],
  },
  cycle: {
    label: "Cycle",
    kind: "options",
    valuesOf: (i) => [
      ...(i.cycle?.isActive ? ["current"] : []),
      i.cycle ? (cycleLabel(i.cycle) ?? NONE) : NONE,
    ],
    fixed: [{ value: "current", label: "Current cycle" }],
  },
  links: {
    label: "Links",
    kind: "options",
    valuesOf: (i) => [i.pullRequestCount > 0 ? "pr" : "no-pr"],
    fixed: [
      { value: "pr", label: "Has a pull request" },
      { value: "no-pr", label: "No pull request" },
    ],
    fixedOnly: true,
  },
  content: { label: "Content", kind: "text", valuesOf: () => [] },
};

/** Fields in the order the Add filter menu lists them, grouped like Linear's. */
export const FILTER_FIELD_GROUPS: FilterField[][] = [
  [
    "team",
    "status",
    "statusType",
    "assignee",
    "creator",
    "priority",
    "estimate",
    "labels",
    "relations",
    "due",
    "created",
    "updated",
  ],
  ["project", "cycle"],
  ["links", "content"],
];

/** The options a field offers for these issues, with how many match each. */
export function filterOptions(
  field: FilterField,
  issues: LinearIssue[],
  now = Date.now(),
): FilterOption[] {
  const def = FILTER_FIELDS[field];
  const counts = new Map<string, number>();
  for (const issue of issues) {
    for (const value of new Set(def.valuesOf(issue, now))) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const fixed = def.fixed ?? [];
  const seen = def.fixedOnly
    ? []
    : [...counts.keys()]
        .filter((v) => v !== NONE && !fixed.some((f) => f.value === v))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((v) => ({ value: v, label: def.labelOf?.(v, issues) ?? v }));
  const none =
    !def.fixedOnly && counts.has(NONE)
      ? [{ value: NONE, label: `No ${def.label.toLowerCase()}` }]
      : [];

  return [...fixed, ...seen, ...none].map((o) => ({
    ...o,
    count: counts.get(o.value) ?? 0,
  }));
}

export function optionLabel(field: FilterField, value: string): string {
  const def = FILTER_FIELDS[field];
  if (value === NONE) {
    return `No ${def.label.toLowerCase()}`;
  }

  return (
    def.fixed?.find((f) => f.value === value)?.label ??
    def.labelOf?.(value, []) ??
    value
  );
}

function matches(
  issue: LinearIssue,
  filter: IssueFilter,
  now: number,
): boolean {
  if (filter.values.length === 0) {
    return true;
  }
  let hit: boolean;
  if (filter.field === "content") {
    const haystack =
      `${issue.identifier} ${issue.title} ${issue.description}`.toLowerCase();
    hit = filter.values.every((term) => haystack.includes(term.toLowerCase()));
  } else {
    const values = FILTER_FIELDS[filter.field].valuesOf(issue, now);
    hit = filter.values.some((v) => values.includes(v));
  }

  return filter.negate ? !hit : hit;
}

export function applyFilters(
  issues: LinearIssue[],
  filters: IssueFilter[],
  now = Date.now(),
): LinearIssue[] {
  return filters.length === 0
    ? issues
    : issues.filter((issue) => filters.every((f) => matches(issue, f, now)));
}

/** The Add filter menu's fields, grouped like Linear's. */
export const FILTER_MENU_FIELDS = FILTER_FIELD_GROUPS.map((group) =>
  group.map((id) => ({
    id,
    label: FILTER_FIELDS[id].label,
    kind: FILTER_FIELDS[id].kind,
  })),
);

/** What a filter chip says after its operator: the values, or how many. */
export function filterSummary(filter: IssueFilter): string {
  if (filter.field === "content") {
    return filter.values.join(" ");
  }
  const labels = filter.values.map((v) => optionLabel(filter.field, v));

  return labels.length > 2
    ? `${labels.length} ${FILTER_FIELDS[filter.field].label.toLowerCase()}`
    : labels.join(", ");
}

export function filterOperator(filter: IssueFilter): string {
  if (filter.field === "content") {
    return filter.negate ? "doesn't contain" : "contains";
  }

  return filter.negate ? "is not" : "is";
}

export function isFilterField(value: string): value is FilterField {
  return value in FILTER_FIELDS;
}

/** How the filter row changed, for telemetry; null when nothing did. */
export type FilterChange = "add" | "flip" | "remove" | null;

/**
 * One field's filter changed (or was removed with null): the row after it,
 * a changed filter keeping its place and a new one going last.
 */
export function updateIssueFilter(
  filters: readonly IssueFilter[],
  field: FilterField,
  change: (f: IssueFilter) => IssueFilter | null,
): { change: FilterChange; filters: IssueFilter[] } {
  const existing = filters.find((f) => f.field === field);
  const next = change(existing ?? { field, negate: false, values: [] });
  const rest = filters.filter((f) => f.field !== field);
  if (!next || next.values.length === 0) {
    return { change: existing ? "remove" : null, filters: rest };
  }
  if (!existing) {
    return { change: "add", filters: [...rest, next] };
  }

  return {
    change: next.negate !== existing.negate ? "flip" : null,
    filters: filters.map((f) => (f.field === field ? next : f)),
  };
}

/** Pick or unpick one option of a field's filter. */
export function toggleFilterValue(
  filters: readonly IssueFilter[],
  field: FilterField,
  value: string,
): { change: FilterChange; filters: IssueFilter[] } {
  return updateIssueFilter(filters, field, (f) => ({
    ...f,
    values: f.values.includes(value)
      ? f.values.filter((v) => v !== value)
      : [...f.values, value],
  }));
}

/** A content filter's text: one term, or no filter when it's cleared. */
export function setFilterText(
  filters: readonly IssueFilter[],
  field: FilterField,
  text: string,
): { change: FilterChange; filters: IssueFilter[] } {
  return updateIssueFilter(filters, field, (f) => ({
    ...f,
    values: text ? [text] : [],
  }));
}

/** "is" ↔ "is not". */
export function flipFilter(
  filters: readonly IssueFilter[],
  field: FilterField,
): { change: FilterChange; filters: IssueFilter[] } {
  return updateIssueFilter(filters, field, (f) => ({
    ...f,
    negate: !f.negate,
  }));
}
