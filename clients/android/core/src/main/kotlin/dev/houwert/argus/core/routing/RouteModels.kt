package dev.houwert.argus.core.routing

import dev.houwert.argus.kit.protocol.generated.UsageRange

// The small models routes carry, from `Stores/InboxFilter.swift` and `Usage/UsageSummaryFormat.swift`.
// Whoever ports those stores should move these there rather than duplicate them.

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

/** The Usage screen's tabs. Limits owns bare `/usage`. */
enum class UsageTab(val rawValue: String, val title: String) {
  Limits("limits", "Limits"),
  Cost("cost", "Cost"),
  Tokens("tokens", "Tokens");

  companion object {
    fun fromRaw(raw: String?): UsageTab? = entries.firstOrNull { it.rawValue == raw }
  }
}

/** The range Usage shows when none is picked; it stays off the URL. */
val UsageRange.Companion.default: UsageRange get() = UsageRange._30d
