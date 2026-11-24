package dev.houwert.argus.core.teammates

import dev.houwert.argus.core.routing.ArgusRoute
import dev.houwert.argus.core.routing.TeammatePage

/** Where a proposal was raised: an automation's run, or a conversation with a teammate. */
sealed interface ProposalOrigin {
  data class Run(val automationId: String, val runId: String) : ProposalOrigin
  data class TeammateChat(val teammateId: String, val threadId: String?) : ProposalOrigin

  val route: ArgusRoute
    get() = when (this) {
      is Run -> ArgusRoute.Automation(automationId, runId)
      is TeammateChat -> ArgusRoute.Teammate(teammateId, TeammatePage.Chat(threadId))
    }

  companion object {
    private const val CHAT_PREFIX = "teammate-chat:"
    private const val THREAD_PREFIX = "thread:"

    /** Null when nothing says which run raised it. */
    fun of(automationId: String, runId: String?): ProposalOrigin? {
      // A conversation files its proposals under a synthetic automation and run.
      if (automationId.startsWith(CHAT_PREFIX)) {
        val teammateId = automationId.removePrefix(CHAT_PREFIX).takeIf { it.isNotEmpty() } ?: return null
        val threadId = runId?.takeIf { it.startsWith(THREAD_PREFIX) }?.removePrefix(THREAD_PREFIX)?.takeIf { it.isNotEmpty() }
        return TeammateChat(teammateId, threadId)
      }
      return runId?.let { Run(automationId, it) }
    }
  }
}
