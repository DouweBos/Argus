/**
 * The Usage model filter (`usage_model_filter` in app settings). It matches a
 * record's own model id, before any mapping, so a model left out can't come
 * back under the name it is mapped to.
 */

import type { UsageRecord } from "./records";
import type { UsageModelFilter, UsageModelRule } from "@argus/remote-protocol";
import { normalizeModelKey } from "./pricing";

export type RecordFilter = (
  r: Pick<UsageRecord, "model" | "runner">,
) => boolean;

export function recordFilter(
  filter: UsageModelFilter | undefined,
): RecordFilter {
  const include = filter?.include ?? [];
  const exclude = filter?.exclude ?? [];
  if (include.length === 0 && exclude.length === 0) {
    return () => true;
  }
  const keyed = (rules: UsageModelRule[]) =>
    rules.map((rule) => ({
      runner: rule.runner?.trim() || null,
      model: normalizeModelKey(rule.model),
    }));
  const inc = keyed(include);
  const exc = keyed(exclude);

  return (r) => {
    const model = normalizeModelKey(r.model);
    const matches = (rule: { runner: string | null; model: string }) =>
      rule.model === model &&
      (rule.runner === null || rule.runner === r.runner);

    return (inc.length === 0 || inc.some(matches)) && !exc.some(matches);
  };
}
