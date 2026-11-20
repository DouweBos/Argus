package dev.houwert.argus.core.stores

import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The warnings, errors and housekeeping notes behind Notifications: in memory, newest first, capped. */
class NotificationsLog(private val now: () -> Long = System::currentTimeMillis) {
  enum class Level(val raw: String) {
    Error("error"),
    Warning("warning"),
    /** Something Argus did on its own that you'd want to know about, like a cleanup. */
    Info("info"),
  }

  data class Entry(
    val id: String,
    val level: Level,
    val message: String,
    val source: String?,
    /** When it first appeared (epoch ms); a repeat doesn't make it new again. */
    val firstAt: Long,
    /** When it last happened. */
    val timestamp: Long,
    /** How many times in a row it happened. */
    val count: Int,
  )

  private val _entries = MutableStateFlow(emptyList<Entry>())
  val entries: StateFlow<List<Entry>> = _entries.asStateFlow()
  private val _lastSeenAt = MutableStateFlow(Long.MIN_VALUE)
  val lastSeenAt: StateFlow<Long> = _lastSeenAt.asStateFlow()

  /** Repeats only count once, so a polling screen's failure can't keep the badge climbing. */
  val unseenCount: Int get() = _entries.value.count { it.firstAt > _lastSeenAt.value }

  fun push(level: Level, message: String, source: String? = null) {
    val at = now()
    val first = _entries.value.firstOrNull()
    // A polling screen repeats its failure every few seconds; keep one entry.
    if (first != null && first.level == level && first.message == message && first.source == source) {
      _entries.value = listOf(first.copy(timestamp = at, count = first.count + 1)) + _entries.value.drop(1)
      return
    }
    val entry = Entry(UUID.randomUUID().toString(), level, message, source, at, at, 1)
    _entries.value = (listOf(entry) + _entries.value).take(CAP)
  }

  fun dismiss(id: String) {
    _entries.value = _entries.value.filterNot { it.id == id }
  }

  fun clear() {
    _entries.value = emptyList()
    _lastSeenAt.value = now()
  }

  fun markSeen() {
    _lastSeenAt.value = now()
  }

  companion object {
    const val CAP = 200
  }
}
