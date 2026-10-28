import type { LinearIssue, LinearIssueScope } from "../../../lib/types";
import { useRef, useState } from "react";
import { Button, FilterChip, FilterMenu, Icons } from "@argus/peacock";
import {
  FILTER_FIELD_GROUPS,
  FILTER_FIELDS,
  type FilterField,
  filterOptions,
  type IssueFilter,
  optionLabel,
} from "../../../lib/issueFilters";
import { capture } from "../../../lib/telemetry";
import {
  setIssueFilters,
  useIssueFilters,
} from "../../../stores/linearIssuesStore";
import styles from "./IssuesScreen.module.css";

const MENU_FIELDS = FILTER_FIELD_GROUPS.map((group) =>
  group.map((id) => ({
    id,
    label: FILTER_FIELDS[id].label,
    kind: FILTER_FIELDS[id].kind,
  })),
);

function summary(filter: IssueFilter): string {
  if (filter.field === "content") {
    return filter.values.join(" ");
  }
  const labels = filter.values.map((v) => optionLabel(filter.field, v));

  return labels.length > 2
    ? `${labels.length} ${FILTER_FIELDS[filter.field].label.toLowerCase()}`
    : labels.join(", ");
}

function operator(filter: IssueFilter): string {
  if (filter.field === "content") {
    return filter.negate ? "doesn't contain" : "contains";
  }

  return filter.negate ? "is not" : "is";
}

interface IssueFilterBarProps {
  /** The unfiltered issues, so each option shows how many it would match. */
  issues: LinearIssue[];
  scope: LinearIssueScope;
}

/** Linear's filter row: Filter, one chip per active filter, Clear. */
export function IssueFilterBar({ issues, scope }: IssueFilterBarProps) {
  const filters = useIssueFilters(scope);
  const [menu, setMenu] = useState<{ field?: FilterField } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);

  const update = (
    field: FilterField,
    change: (f: IssueFilter) => IssueFilter | null,
  ) => {
    const current = filters.find((f) => f.field === field) ?? {
      field,
      negate: false,
      values: [],
    };
    const next = change(current);
    const rest = filters.filter((f) => f.field !== field);
    const existed = filters.some((f) => f.field === field);
    if (!next || next.values.length === 0) {
      if (existed) {
        capture("issue_filter_changed", { action: "remove", field });
      }
      setIssueFilters(scope, rest);

      return;
    }
    if (!existed) {
      capture("issue_filter_changed", { action: "add", field });
    } else if (next.negate !== current.negate) {
      capture("issue_filter_changed", { action: "flip", field });
    }
    // Keep a changed filter where it was in the row; a new one goes last.
    setIssueFilters(
      scope,
      filters.some((f) => f.field === field)
        ? filters.map((f) => (f.field === field ? next : f))
        : [...rest, next],
    );
  };

  return (
    <div ref={anchor} className={styles.filterBar}>
      <Button
        variant="ghost"
        size="sm"
        leading={<Icons.FilterIcon size={12} />}
        onClick={() => setMenu(menu ? null : {})}
      >
        Filter
      </Button>
      {filters.map((filter) => (
        <FilterChip
          key={filter.field}
          field={FILTER_FIELDS[filter.field].label}
          operator={operator(filter)}
          value={summary(filter)}
          onClick={() => setMenu({ field: filter.field })}
          onOperatorClick={() =>
            update(filter.field, (f) => ({ ...f, negate: !f.negate }))
          }
          onRemove={() => update(filter.field, () => null)}
        />
      ))}
      {filters.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            capture("issue_filter_changed", { action: "clear", field: "all" });
            setIssueFilters(scope, []);
          }}
        >
          Clear
        </Button>
      )}
      {menu && (
        <FilterMenu
          key={menu.field ?? "fields"}
          fields={MENU_FIELDS}
          initialField={menu.field}
          optionsFor={(id) => filterOptions(id as FilterField, issues)}
          selected={(id) => filters.find((f) => f.field === id)?.values ?? []}
          triggerRef={anchor}
          onClose={() => setMenu(null)}
          onText={(id, text) =>
            update(id as FilterField, (f) => ({
              ...f,
              values: text ? [text] : [],
            }))
          }
          onToggle={(id, value) =>
            update(id as FilterField, (f) => ({
              ...f,
              values: f.values.includes(value)
                ? f.values.filter((v) => v !== value)
                : [...f.values, value],
            }))
          }
        />
      )}
    </div>
  );
}
