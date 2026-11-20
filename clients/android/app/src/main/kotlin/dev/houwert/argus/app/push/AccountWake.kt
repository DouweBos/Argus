package dev.houwert.argus.app.push

import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.app.telemetry.TelemetryEvent.WakeOutcome
import dev.houwert.argus.app.telemetry.TelemetryEvent.WakeReason
import dev.houwert.argus.core.account.AccountWakeResult
import dev.houwert.argus.kit.account.AccountJoinRequestInfo
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.push.PushData
import dev.houwert.argus.kit.push.SealedNotification
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.storage.Preferences

/**
 * A content-free push from the account service ("look again"): a device asked to join, or someone
 * was added or removed. The phone re-reads and verifies the account itself, so removals apply and
 * approvers get prompted without the app being open. Mirrors the iPhone's `AccountWake`.
 */
class AccountWake(
  private val preferences: Preferences,
  /** The account store's `handleWake`, or null when this install isn't on an account. */
  private val wake: suspend (alreadySeen: Set<String>) -> AccountWakeResult?,
  private val inForeground: () -> Boolean,
  private val notify: (tag: String, SealedNotification) -> Unit,
  private val capture: (TelemetryEvent) -> Unit,
) {
  /** True once the account was reached. */
  suspend fun handle(reason: WakeReason): Boolean {
    val seen = seen()
    val result = wake(seen) ?: run {
      capture(TelemetryEvent.AccountWoken(reason, WakeOutcome.Unreachable))
      return false
    }
    if (result.newRequests.isNotEmpty()) {
      val ids = result.newRequests.map { it.requestId }
      preferences.set((seen.toList() + ids).takeLast(SEEN_LIMIT).joinToString("\n"), PreferenceKey.ACCOUNT_PROMPTED_JOINS)
      // In the app, the in-app join prompt shows it instead.
      if (!inForeground()) result.newRequests.forEach { request -> prompt(request)?.let { notify("account-join-${request.requestId}", it) } }
    }
    capture(TelemetryEvent.AccountWoken(reason, outcome(result)))
    return result.reached
  }

  private fun seen(): Set<String> =
    preferences.string(PreferenceKey.ACCOUNT_PROMPTED_JOINS)?.split("\n")?.filter { it.isNotEmpty() }?.toSet().orEmpty()

  companion object {
    private const val SEEN_LIMIT = 50

    /** `join` or `changed`, if this data-only message is an account wake-up at all. */
    fun reason(data: Map<String, String>): WakeReason? = data[PushData.ACCOUNT]?.let { raw -> WakeReason.entries.firstOrNull { it.wire == raw } }

    fun outcome(result: AccountWakeResult): WakeOutcome = when {
      !result.reached -> WakeOutcome.Unreachable
      result.reset -> WakeOutcome.Reset
      result.removed -> WakeOutcome.Removed
      result.newRequests.isEmpty() -> WakeOutcome.Refreshed
      else -> WakeOutcome.Prompted
    }

    /** "Approve a new device?" The in-app prompt takes over once the app opens. */
    fun prompt(request: AccountJoinRequestInfo): SealedNotification? {
      val member = request.subject?.member ?: return null
      return SealedNotification(
        title = if (member.role == AccountMember.Role.Host) "Approve a new computer?" else "Approve a new device?",
        body = "“${member.name}” wants to join your Argus account. Open Argus and compare the codes before you approve.",
        kind = "account_join",
      )
    }
  }
}
