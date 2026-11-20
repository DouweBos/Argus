package dev.houwert.argus.ui.inbox

import dev.houwert.argus.kit.protocol.generated.RemoteProposal

/** The inbox's share of `AutomationText`: how a proposal's state reads. */
object ProposalText {
  fun plural(count: Int, noun: String): String = "$count $noun${if (count == 1) "" else "s"}"

  /** How far a proposal's start has got. */
  fun stage(rawValue: String?): String = when (rawValue) {
    "creating_worktree" -> "Creating worktree"
    "setting_up" -> "Running setup"
    "starting_agent" -> "Starting agent"
    else -> "Starting"
  }

  /** What became of a proposal that can no longer be acted on; null while it's pending. */
  fun decidedNote(proposal: RemoteProposal): String? {
    val automation = proposal.automationName
    val cleared = proposal.clearedReason?.let { ": $it" }
    return when (proposal.status.rawValue) {
      "pending" -> null
      "accepted" -> proposal.acceptedNote?.let { "You started this, with the note: $it" } ?: "You started this."
      "auto_started" -> "Argus started this itself — the guardrails allowed it."
      "dismissed" -> proposal.dismissedReason?.let { "You dismissed this: $it" } ?: "You dismissed this."
      "resolved" -> proposal.resolvedNote?.let { "You marked this done: $it" } ?: "You marked this done — you handled it yourself."
      "superseded" -> "A later run of $automation proposed the same work again${cleared ?: "."}"
      else -> "$automation withdrew this${cleared ?: " — the signal behind it went away."}"
    }
  }
}
