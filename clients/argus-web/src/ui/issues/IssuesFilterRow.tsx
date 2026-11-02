/** Linear's filter row over a scope's filters, kept in this browser. */

import {
  FILTER_FIELDS,
  FILTER_MENU_FIELDS,
  type FilterChange,
  type FilterField,
  filterOperator,
  filterOptions,
  filterSummary,
  flipFilter,
  type IssueFilter,
  type IssueScope,
  isFilterField,
  setFilterText,
  toggleFilterValue,
  updateIssueFilter,
} from "@argus/client-core";
import { IssueFilterBar } from "@argus/peacock";
import type { LinearIssue } from "@argus/remote-protocol";
import { setIssueFilters, useIssuesStore } from "../../stores/issues";
import { capture } from "../../telemetry/telemetry";

type Update = (
  filters: IssueFilter[],
  field: FilterField,
) => { change: FilterChange; filters: IssueFilter[] };

export function IssuesFilterRow({
  issues,
  scope,
}: {
  /** The unfiltered issues, so each option shows how many it would match. */
  issues: LinearIssue[];
  scope: IssueScope;
}) {
  const filters = useIssuesStore((s) => s.filters[scope]);
  const apply = (field: string, update: Update) => {
    if (!isFilterField(field)) {
      return;
    }
    const result = update(filters, field);
    if (result.change) {
      capture("web_issue_filter_changed", { action: result.change, field });
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
        capture("web_issue_filter_changed", { action: "clear", field: "all" });
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
