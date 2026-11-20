package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.displayName
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.subtitle

/** The Claude account an automation's runs are pinned to; mirrors `automationAccountOptions` in client-core. */
object AutomationAccountPin {
  /** [value] empty follows the computer's active account. */
  data class Option(val value: String, val name: String, val hint: String?)

  /** Custom runners bring their own credentials; null is the computer's default runner. */
  fun appliesToRunner(runner: String?): Boolean = runner == null || runner == "claude-code"

  /** With one account there's nothing to pick, but a set pin stays so it can be cleared. */
  fun offered(accounts: List<RemoteClaudeAccount>, pinned: String?): Boolean = accounts.size > 1 || pinned != null

  /** "Default account" first, then every account, then a pin to one since signed out. */
  fun options(accounts: List<RemoteClaudeAccount>, activeId: String?, pinned: String?): List<Option> {
    val active = accounts.firstOrNull { it.id == activeId }
    val options = mutableListOf(
      Option("", "Default account", active?.let { "Follows the computer: ${it.displayName}" } ?: "Follows the computer's active account"),
    )
    options += accounts.map { Option(it.id, it.displayName, it.subtitle.ifEmpty { null }) }
    if (pinned != null && accounts.none { it.id == pinned }) {
      options += Option(pinned, "Signed-out account", "Runs fail until it is signed back in")
    }
    return options
  }

  const val PINNED_CAPTION = "Runs only on this account, and never move to another one when its plan limit is reached."
}
