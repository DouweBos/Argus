import type { IssueScope } from "../../../lib/router";
import type { LinearIssue } from "../../../lib/types";
import {
  FILTER_FIELDS,
  FILTER_MENU_FIELDS,
  type FilterChange,
  filterOperator,
  filterOptions,
  filterSummary,
  flipFilter,
  type IssueFilter,
  isFilterField,
  setFilterText,
  toggleFilterValue,
  updateIssueFilter,
} from "@argus/client-core";
import { IssueFilterBar } from "@argus/peacock";
import { capture } from "../../../lib/telemetry";
import {
  setIssueFilters,
  useIssueFilters,
} from "../../../stores/linearIssuesStore";

interface IssuesFilterRowProps {
  /** The unfiltered issues, so each option shows how many it would match. */
  issues: LinearIssue[];
  scope: IssueScope;
}

/** Linear's filter row over the scope's saved filters. */
export function IssuesFilterRow({ issues, scope }: IssuesFilterRowProps) {
  const filters = useIssueFilters(scope);
  const apply = (
    field: string,
    next: (
      filters: IssueFilter[],
      field: keyof typeof FILTER_FIELDS,
    ) => { change: FilterChange; filters: IssueFilter[] },
  ) => {
    if (!isFilterField(field)) {
      return;
    }
    const result = next(filters, field);
    if (result.change) {
      capture("issue_filter_changed", { action: result.change, field });
    }
    setIssueFilters(scope, result.filters);
  };

  return (
    <IssueFilterBar
      chips={filters.map((f) => ({
        field: f.field,
        label: FILTER_FIELDS[f.field].label,
        operator: filterOperator(f),
        value: filterSummary(f),
      }))}
      fields={FILTER_MENU_FIELDS}
      optionsFor={(id) => (isFilterField(id) ? filterOptions(id, issues) : [])}
      selected={(id) => filters.find((f) => f.field === id)?.values ?? []}
      onClear={() => {
        capture("issue_filter_changed", { action: "clear", field: "all" });
        setIssueFilters(scope, []);
      }}
      onFlip={(id) => apply(id, flipFilter)}
      onRemove={(id) =>
        apply(id, (all, f) => updateIssueFilter(all, f, () => null))
      }
      onText={(id, text) => apply(id, (all, f) => setFilterText(all, f, text))}
      onToggle={(id, value) =>
        apply(id, (all, f) => toggleFilterValue(all, f, value))
      }
    />
  );
}
