package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteProposal

/**
 * Which automation's and which project's items the inbox shows; empty shows everything.
 * Part of the `/inbox` route, as `?automation=&project=`.
 */
data class InboxFilter(
  val automationId: String? = null,
  /** A project's folder name, as the gateway names projects. */
  val project: String? = null,
) {
  val isEmpty: Boolean get() = automationId == null && project == null

  companion object {
    val all = InboxFilter()
  }
}

fun InboxFilter.matches(proposal: RemoteProposal): Boolean =
  (automationId == null || proposal.automationId == automationId) && (project == null || proposal.project == project)

/** A run belongs to no project, so a project filter excludes every run. */
fun InboxFilter.matches(run: RemoteAutomationRun): Boolean =
  project == null && (automationId == null || run.automationId == automationId)

/** One entry of an inbox filter menu. */
data class InboxFilterOption(val value: String, val label: String, val count: Int)

data class InboxFilterOptions(val automations: List<InboxFilterOption>, val projects: List<InboxFilterOption>) {
  /** "Weekly analysis · Argus": what a filter narrows the inbox to. */
  fun summary(filter: InboxFilter): String = listOfNotNull(
    filter.automationId?.let { id -> automations.firstOrNull { it.value == id }?.label ?: "One automation" },
    filter.project,
  ).joinToString(" · ")
}

/** Which inbox filter a user changed, for telemetry. */
enum class InboxFilterField(val wire: String) { Automation("automation"), Project("project"), Clear("clear") }
