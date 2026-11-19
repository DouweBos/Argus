package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.isUnavailable

/** What a session's agents are up to, as one state and a line of text, the same on every screen. */
data class SessionActivity(val session: RemoteSession, val agents: List<RemoteAgentStatus>) {
  /** One step coarser than the status: what a dot beside the session says. */
  enum class State { Unavailable, Failed, Preparing, Waiting, Working, Unread, Idle }

  val isBusy: Boolean
    get() = session.status == RemoteSessionStatus.initializing || agents.any { it.status == RemoteAgentStatusStatus.running }

  val state: State
    get() = when {
      session.isUnavailable -> State.Unavailable
      session.status == RemoteSessionStatus.error -> State.Failed
      session.status == RemoteSessionStatus.initializing || session.status == RemoteSessionStatus.deleting -> State.Preparing
      agents.any { it.awaiting != null } -> State.Waiting
      isBusy -> State.Working
      session.unread == true -> State.Unread
      else -> State.Idle
    }

  /** Worth a dot: working, waiting on you, finished unread, broken, or setting up. An idle session shows none. */
  val showsDot: Boolean
    get() = when (state) {
      State.Failed, State.Waiting, State.Working, State.Unread -> true
      State.Preparing -> session.status == RemoteSessionStatus.initializing
      State.Unavailable, State.Idle -> false
    }

  /** "Setting up", the error, or how many agents there are. */
  val statusText: String?
    get() = when (session.status) {
      RemoteSessionStatus.error -> session.setupError ?: statusLabel(RemoteSessionStatus.error)
      RemoteSessionStatus.ready -> if (agents.isEmpty()) null else "${agents.size} agent${if (agents.size == 1) "" else "s"}"
      else -> statusLabel(session.status)
    }

  /** When one of its agents last did something, in epoch milliseconds. */
  val lastActive: Double? get() = agents.mapNotNull { it.lastActivityAt ?: it.createdAt }.maxOrNull()

  /** The session's title: its name, else its branch. */
  val title: String get() = title(session)

  /** The branch, only when the title doesn't already say it. */
  val subtitle: String? get() = subtitle(session)

  companion object {
    /** "Setting up", "Deleting" or "Setup failed"; null once ready. */
    fun statusLabel(status: RemoteSessionStatus): String? = when (status) {
      RemoteSessionStatus.initializing -> "Setting up"
      RemoteSessionStatus.deleting -> "Deleting"
      RemoteSessionStatus.error -> "Setup failed"
      else -> null
    }

    fun title(session: RemoteSession): String = session.displayName?.ifEmpty { null } ?: session.branch

    fun subtitle(session: RemoteSession): String? =
      if (title(session) == session.branch || session.branch.isEmpty()) null else session.branch
  }
}

/** How a session stands against its upstream, as one line. */
object GitUpstreamText {
  fun describe(git: RemoteGitStatus): String {
    val upstream = git.upstream ?: return "Not pushed"
    val parts = buildList {
      if (git.ahead > 0) add("↑${git.ahead.toInt()}")
      if (git.behind > 0) add("↓${git.behind.toInt()}")
    }
    return if (parts.isEmpty()) "Up to date with $upstream" else "${parts.joinToString(" ")} $upstream"
  }

  /** Whether there is anything to say beyond "up to date". */
  fun isNoteworthy(git: RemoteGitStatus): Boolean = git.upstream == null || git.ahead > 0 || git.behind > 0
}
