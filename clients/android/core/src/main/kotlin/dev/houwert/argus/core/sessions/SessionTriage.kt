package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.kit.protocol.isOpen
import dev.houwert.argus.kit.protocol.isUnavailable
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters

/**
 * Where a session sorts: what needs you first, then what's running, then the rest; done and
 * snoozed ones fold away. Declaration order is the sort order.
 */
enum class SessionAttention(val title: String) {
  NeedsYou("Needs you"),
  Working("Working"),
  Idle("Idle"),
  Done("Done"),
  Snoozed("Snoozed"),
}

/** Snoozed until a time still to come. */
fun RemoteSession.isSnoozed(nowMillis: Long = System.currentTimeMillis()): Boolean =
  snoozedUntil?.let { it > nowMillis } ?: false

val RemoteSession.snoozedUntilInstant: Instant? get() = snoozedUntil?.let { Instant.ofEpochMilli(it.toLong()) }

/** Marked done, or its pull request merged or closed and not kept active. */
val RemoteSession.isDone: Boolean
  get() {
    settled?.let { return it }
    val state = pullRequest?.state ?: return false
    return state == SessionPullRequestState.merged || state == SessionPullRequestState.closed
  }

/**
 * Blocked on a permission, a question or a plan, a turn finished unread, or setup failed. A new turn
 * running supersedes the unread one: the host only clears it when a client opens the session.
 */
val SessionActivity.needsYou: Boolean
  get() {
    if (session.isUnavailable) return false
    return session.status == RemoteSessionStatus.error ||
      (session.unread == true && !isBusy) ||
      agents.any { it.awaiting != null || it.status == RemoteAgentStatusStatus.requiresAction }
  }

/** A needs-you session shows whatever it's snoozed or done as: something is waiting on it. */
fun SessionActivity.attention(nowMillis: Long = System.currentTimeMillis()): SessionAttention = when {
  needsYou -> SessionAttention.NeedsYou
  session.isSnoozed(nowMillis) -> SessionAttention.Snoozed
  isBusy || (session.pullRequestWatched == true && session.pullRequest?.isOpen == true) -> SessionAttention.Working
  session.isDone -> SessionAttention.Done
  else -> SessionAttention.Idle
}

/**
 * A list of sessions split by attention, each newest message first ([SessionRecency]). Build it with
 * `SessionTriage(sessions, now) { agentsOf(it) }`; the constructor takes no defaults so that call can't hit it.
 */
data class SessionTriage(
  val needsYou: List<RemoteSession>,
  /** Working first, then idle. */
  val active: List<RemoteSession>,
  val done: List<RemoteSession>,
  val snoozed: List<RemoteSession>,
) {
  /** Everything folded away. */
  val folded: List<RemoteSession> get() = done + snoozed

  /** "2 done · 1 snoozed". */
  val foldedLabel: String get() = foldedLabel(done.size, snoozed.size)

  companion object {
    operator fun invoke(
      sessions: List<RemoteSession>,
      nowMillis: Long = System.currentTimeMillis(),
      agents: (RemoteSession) -> List<RemoteAgentStatus>,
    ): SessionTriage {
      val buckets = SessionAttention.entries.associateWith { mutableListOf<RemoteSession>() }
      val attention = sessions.map { SessionActivity(it, agents(it)).attention(nowMillis) }
      val runs = runAttention(sessions.map { it.compareGroup?.id }.zip(attention))
      sessions.zip(attention).forEach { (session, own) ->
        buckets.getValue(session.compareGroup?.let { runs[it.id] } ?: own) += session
      }
      fun recent(attention: SessionAttention) = SessionRecency.sorted(buckets.getValue(attention))
      return SessionTriage(
        needsYou = recent(SessionAttention.NeedsYou),
        active = recent(SessionAttention.Working) + recent(SessionAttention.Idle),
        done = recent(SessionAttention.Done),
        snoozed = recent(SessionAttention.Snoozed),
      )
    }

    fun foldedLabel(done: Int, snoozed: Int): String =
      listOfNotNull(if (done == 0) null else "$done done", if (snoozed == 0) null else "$snoozed snoozed")
        .joinToString(" · ")

    /** A compare run sorts as its most urgent slot, so its slots stay together under one header. */
    internal fun runAttention(pairs: List<Pair<String?, SessionAttention>>): Map<String, SessionAttention> {
      val runs = HashMap<String, SessionAttention>()
      for ((run, attention) in pairs) {
        if (run != null) runs[run] = minOf(runs[run] ?: attention, attention)
      }
      return runs
    }
  }
}

/** The ready-made times a session can be snoozed until. */
enum class SnoozePreset(val title: String) {
  OneHour("For 1 Hour"),
  ThisEvening("Until This Evening"),
  Tomorrow("Until Tomorrow Morning"),
  NextWeek("Until Next Week");

  /** When it ends, or null when it makes no sense now (this evening, once evening has come). */
  fun date(now: ZonedDateTime = ZonedDateTime.now()): ZonedDateTime? = when (this) {
    OneHour -> now.plusHours(1)
    ThisEvening -> now.toLocalDate().atTime(18, 0).atZone(now.zone).takeIf { it.isAfter(now.plusMinutes(30)) }
    Tomorrow -> now.toLocalDate().plusDays(1).atTime(9, 0).atZone(now.zone)
    NextWeek -> {
      val monday = now.toLocalDate().with(TemporalAdjusters.nextOrSame(DayOfWeek.MONDAY)).atTime(9, 0).atZone(now.zone)
      if (monday.isAfter(now)) monday else monday.plusWeeks(1)
    }
  }
}

/**
 * The phone's session groups split the same way. The project root and sessions known only from
 * their agents stay active; the root never folds away.
 */
data class SessionGroupTriage(
  val needsYou: List<SessionGroup>,
  val active: List<SessionGroup>,
  val done: List<SessionGroup>,
  val snoozed: List<SessionGroup>,
) {
  val folded: List<SessionGroup> get() = done + snoozed

  /** "2 done · 1 snoozed". */
  val foldedLabel: String get() = SessionTriage.foldedLabel(done.size, snoozed.size)

  companion object {
    operator fun invoke(groups: List<SessionGroup>, nowMillis: Long = System.currentTimeMillis()): SessionGroupTriage {
      val needsYou = mutableListOf<SessionGroup>()
      val working = mutableListOf<SessionGroup>()
      val idle = mutableListOf<SessionGroup>()
      val done = mutableListOf<SessionGroup>()
      val snoozed = mutableListOf<SessionGroup>()
      val own = groups.map { group -> group.session?.let { SessionActivity(it, group.agents).attention(nowMillis) } }
      val runs = SessionTriage.runAttention(
        groups.zip(own).mapNotNull { (group, attention) -> attention?.let { group.session?.compareGroup?.id to it } },
      )
      groups.zip(own).forEach { (group, attention) ->
        val session = group.session
        if (session == null || attention == null) {
          idle += group
          return@forEach
        }
        when (session.compareGroup?.let { runs[it.id] } ?: attention) {
          SessionAttention.NeedsYou -> needsYou += group
          SessionAttention.Working -> working += group
          SessionAttention.Done -> if (group.isRoot) idle += group else done += group
          SessionAttention.Snoozed -> if (group.isRoot) idle += group else snoozed += group
          SessionAttention.Idle -> idle += group
        }
      }
      fun recent(list: List<SessionGroup>) = SessionRecency.sorted(list) { it.session }
      // The root keeps its place at the top.
      val roots = (working + idle).filter { it.isRoot }
      return SessionGroupTriage(
        needsYou = recent(needsYou),
        active = roots + recent(working.filter { !it.isRoot }) + recent(idle.filter { !it.isRoot }),
        done = recent(done),
        snoozed = recent(snoozed),
      )
    }
  }
}
