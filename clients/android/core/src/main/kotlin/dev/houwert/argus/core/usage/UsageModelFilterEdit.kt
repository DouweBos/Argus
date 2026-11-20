package dev.houwert.argus.core.usage

import dev.houwert.argus.kit.protocol.generated.UsageModelFilter
import dev.houwert.argus.kit.protocol.generated.UsageModelRule

/** Usage's "count only" and "leave out" model lists, as every app edits them. */
enum class UsageModelFilterList(val title: String, val footer: String) {
  Include("Count only these models", "With any model here, Usage's cost and tokens count only these. Empty counts every model."),
  Exclude("Leave out these models", "Usage's cost and tokens never count these models."),
}

object UsageModelFilters {
  val empty = UsageModelFilter(include = emptyList(), exclude = emptyList())
}

/** The host clears an empty filter, so it goes over the wire as null. */
val UsageModelFilter.orNull: UsageModelFilter? get() = if (include.isEmpty() && exclude.isEmpty()) null else this

operator fun UsageModelFilter.get(list: UsageModelFilterList): List<UsageModelRule> =
  if (list == UsageModelFilterList.Include) include else exclude

fun UsageModelFilter.with(list: UsageModelFilterList, rules: List<UsageModelRule>): UsageModelFilter =
  if (list == UsageModelFilterList.Include) copy(include = rules) else copy(exclude = rules)

/** Null when [rule] is already on that list. */
fun UsageModelFilter.adding(rule: UsageModelRule, list: UsageModelFilterList): UsageModelFilter? {
  if (this[list].any { it.model == rule.model && it.runner == rule.runner }) return null
  return with(list, this[list] + rule)
}

/** Replaces the rule at [index], or removes it when [rule] is null. */
fun UsageModelFilter.changing(index: Int, list: UsageModelFilterList, rule: UsageModelRule?): UsageModelFilter {
  val rules = this[list]
  if (index !in rules.indices) return this
  val next = rules.toMutableList()
  if (rule != null) next[index] = rule else next.removeAt(index)
  return with(list, next)
}
