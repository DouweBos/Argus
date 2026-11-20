package dev.houwert.argus.core.compare

import dev.houwert.argus.core.sessions.SessionGroup
import dev.houwert.argus.kit.protocol.generated.RemoteCompareRun
import dev.houwert.argus.kit.protocol.generated.RemoteCompareRunState
import dev.houwert.argus.kit.protocol.generated.RemoteCompareSlot
import dev.houwert.argus.kit.protocol.generated.RemoteCompareSlotAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession

// One slot of a compare run as the computer scores it: the generated `RemoteCompareSlot`.

/** Run commands other than tests. */
val RemoteCompareSlot.appRuns: List<RemoteCompareRun> get() = runs.filter { !it.isTest }
val RemoteCompareSlot.testRuns: List<RemoteCompareRun> get() = runs.filter { it.isTest }

/** Still working: no agent yet, or its agent mid-turn. */
val RemoteCompareSlot.isWorking: Boolean get() = agentId == null || agentStatus == RemoteCompareSlotAgentStatus.running

object CompareRuns {
  /** The worst of a set: any failure fails it, then any still running; null when there are none. */
  fun summary(runs: List<RemoteCompareRun>): RemoteCompareRunState? = when {
    runs.isEmpty() -> null
    runs.any { it.state == RemoteCompareRunState.failed } -> RemoteCompareRunState.failed
    runs.any { it.state == RemoteCompareRunState.running } -> RemoteCompareRunState.running
    else -> RemoteCompareRunState.passed
  }
}

/** How a kept slot lands. */
enum class CompareLanding(val wire: String, val label: String) {
  Merge("merge", "Merge into base"),
  PullRequest("pull_request", "Open a pull request"),
  None("none", "Keep the branch as it is"),
}

/** The sessions of one compare run, in slot order. */
data class CompareGroup(val id: String, val sessions: List<RemoteSession>) {
  /** The run's name: its sessions share the prompt, so the first one's. */
  val title: String get() = sessions.firstOrNull()?.let { it.displayName ?: it.branch } ?: "Compare"

  companion object {
    /** Compare runs among [sessions], each where its first slot sits; a run down to one slot reads as a plain session. */
    fun split(sessions: List<RemoteSession>): List<CompareListItem> {
      val byGroup = sessions.filter { it.compareGroup != null }.groupBy { it.compareGroup!!.id }
      val seen = mutableSetOf<String>()
      val items = mutableListOf<CompareListItem>()
      for (session in sessions) {
        val groupId = session.compareGroup?.id
        val members = groupId?.let { byGroup[it] }
        if (groupId == null || members == null || members.size <= 1) {
          items += CompareListItem.Session(session)
          continue
        }
        if (!seen.add(groupId)) continue
        items += CompareListItem.Group(CompareGroup(groupId, members.sortedBy { it.compareGroup?.slot ?: 0 }))
      }
      return items
    }

    /** The sessions in the order [split] shows them. */
    fun displayOrder(sessions: List<RemoteSession>): List<RemoteSession> = split(sessions).flatMap {
      when (it) {
        is CompareListItem.Session -> listOf(it.session)
        is CompareListItem.Group -> it.group.sessions
      }
    }
  }
}

/** A row of a session list: a session, or a compare run's header with its slots. */
sealed interface CompareListItem {
  val id: String

  data class Session(val session: RemoteSession) : CompareListItem {
    override val id: String get() = session.id
  }

  data class Group(val group: CompareGroup) : CompareListItem {
    override val id: String get() = "compare:${group.id}"
  }
}

/** A row of a project's session list: a session group, or a compare run's header with its slots. */
sealed interface CompareSessionRow {
  val id: String

  data class Session(val group: SessionGroup) : CompareSessionRow {
    override val id: String get() = group.id
  }

  data class Compare(val run: CompareGroup, val slots: List<SessionGroup>) : CompareSessionRow {
    override val id: String get() = "compare:${run.id}"
  }

  companion object {
    /** [groups] with each compare run's slots folded under one header where its first slot sat. */
    fun make(groups: List<SessionGroup>): List<CompareSessionRow> {
      val byId = groups.associateBy { it.id }
      val runOf = mutableMapOf<String, CompareGroup>()
      CompareGroup.split(groups.mapNotNull { it.session }).filterIsInstance<CompareListItem.Group>().forEach { item ->
        item.group.sessions.forEach { runOf[it.id] = item.group }
      }
      val shown = mutableSetOf<String>()
      val rows = mutableListOf<CompareSessionRow>()
      for (group in groups) {
        val run = runOf[group.id]
        if (run == null) {
          rows += Session(group)
          continue
        }
        if (!shown.add(run.id)) continue
        rows += Compare(run, run.sessions.mapNotNull { byId[it.id] })
      }
      return rows
    }
  }
}
