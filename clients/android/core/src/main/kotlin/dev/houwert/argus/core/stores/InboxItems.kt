package dev.houwert.argus.core.stores

import dev.houwert.argus.core.routing.InboxFilter
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.protocol.generated.RemoteProposal
import dev.houwert.argus.kit.protocol.generated.RemoteProposalStatus
import dev.houwert.argus.core.automations.isActive

/** Where a proposal sits in the inbox. */
enum class InboxProposalPhase { Pending, Started, Cleared, Decided }

val RemoteProposal.inboxPhase: InboxProposalPhase
  get() = when (status) {
    RemoteProposalStatus.pending -> InboxProposalPhase.Pending
    RemoteProposalStatus.accepted, RemoteProposalStatus.autoStarted -> InboxProposalPhase.Started
    RemoteProposalStatus.superseded, RemoteProposalStatus.withdrawn -> InboxProposalPhase.Cleared
    else -> InboxProposalPhase.Decided
  }

val RemoteAutomationRun.isFailed: Boolean get() = status == RemoteAutomationRunStatus.failed

/** Opened or dismissed; an older computer never says, so its failures stay until they age out. */
val RemoteAutomationRun.isRead: Boolean get() = reportRead ?: false

val RemoteAutomationRun.hasUnreadReport: Boolean get() = unreadReport && !isActive

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

/**
 * What the inbox is made of, grouped by what you would do about it rather than
 * by which automation produced it: the desktop's `useInboxItems`.
 */
data class InboxItems(
  /** Decisions waiting on you. */
  val pending: List<RemoteProposal>,
  /** Finished runs whose report nobody has opened yet. */
  val reports: List<RemoteAutomationRun>,
  /** Work Argus already started, whose session still exists. */
  val started: List<RemoteProposal>,
  /** Recent failures nobody dismissed: the automation needs a look. */
  val failed: List<RemoteAutomationRun>,
  /** Taken off your hands by a later run, for information. */
  val cleared: List<RemoteProposal>,
) {
  val isEmpty: Boolean
    get() = pending.isEmpty() && reports.isEmpty() && started.isEmpty() && failed.isEmpty() && cleared.isEmpty()

  /** How many things are actually waiting on you: what a badge would show. */
  val actionCount: Int get() = pending.size + failed.size + reports.size

  /** The same groups narrowed to one automation and/or project. */
  fun filtered(filter: InboxFilter): InboxItems {
    if (filter.isEmpty) return this
    return InboxItems(
      pending = pending.filter(filter::matches),
      reports = reports.filter(filter::matches),
      started = started.filter(filter::matches),
      failed = failed.filter(filter::matches),
      cleared = cleared.filter(filter::matches),
    )
  }

  /** Every automation and project with something in these groups, plus the current selection so it can be undone. */
  fun filterOptions(selected: InboxFilter, automationName: (String) -> String?): InboxFilterOptions {
    val proposals = pending + started + cleared
    val runs = failed + reports
    val automations = linkedMapOf<String, Int>()
    (proposals.map { it.automationId } + runs.map { it.automationId }).forEach { automations[it] = (automations[it] ?: 0) + 1 }
    val projects = linkedMapOf<String, Int>()
    proposals.mapNotNull { it.project }.forEach { projects[it] = (projects[it] ?: 0) + 1 }
    selected.automationId?.let { automations.putIfAbsent(it, 0) }
    selected.project?.let { projects.putIfAbsent(it, 0) }
    val byLabel = compareBy<InboxFilterOption, String>(String.CASE_INSENSITIVE_ORDER) { it.label }
    return InboxFilterOptions(
      automations = automations.map { (id, count) -> InboxFilterOption(id, automationName(id) ?: "Automation", count) }.sortedWith(byLabel),
      projects = projects.map { (name, count) -> InboxFilterOption(name, name, count) }.sortedWith(byLabel),
    )
  }

  /** Home's slice of the inbox: enough to act on without home turning into it. */
  fun needsYou(maxProposals: Int = 2, maxFailed: Int = 2): NeedsYou {
    val proposals = pending.take(maxProposals)
    val runs = failed.take(maxFailed)
    val waiting = pending.size + failed.size
    return NeedsYou(proposals, runs, waiting, waiting - proposals.size - runs.size)
  }

  data class NeedsYou(
    val proposals: List<RemoteProposal>,
    val failed: List<RemoteAutomationRun>,
    /** Decisions plus failures; reports are news, not something waiting. */
    val waiting: Int,
    /** Waiting but past the cut, for "N more in the inbox". */
    val hidden: Int,
  )

  companion object {
    /** A failure or a cleared proposal older than this is history, not an inbox item. */
    const val WINDOW_MS = 24.0 * 60 * 60 * 1000
    const val MAX_FAILED_RUNS = 5

    /** [now] is in milliseconds, like every host timestamp. */
    operator fun invoke(proposals: List<RemoteProposal>, runs: List<RemoteAutomationRun>, sessionIds: Set<String>, now: Double) =
      InboxItems(
        pending = proposals.filter { it.inboxPhase == InboxProposalPhase.Pending },
        // A failed run is already listed as a failure; its report would ask twice.
        reports = runs.filter { !it.isFailed && it.hasUnreadReport },
        // A merged or deleted session leaves its proposal started with nothing to open.
        started = proposals.filter { it.inboxPhase == InboxProposalPhase.Started && it.sessionId?.let { id -> id in sessionIds } == true },
        failed = runs.filter { it.isFailed && !it.isRead && now - it.startedAt < WINDOW_MS }.take(MAX_FAILED_RUNS),
        cleared = proposals.filter { p -> p.inboxPhase == InboxProposalPhase.Cleared && p.clearedAt?.let { now - it < WINDOW_MS } == true },
      )
  }
}
