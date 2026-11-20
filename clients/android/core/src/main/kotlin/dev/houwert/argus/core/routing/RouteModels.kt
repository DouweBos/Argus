package dev.houwert.argus.core.routing

// The small models routes carry, from `Stores/InboxFilter.swift`.
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
