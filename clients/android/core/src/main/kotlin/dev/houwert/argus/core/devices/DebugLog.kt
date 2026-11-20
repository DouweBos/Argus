package dev.houwert.argus.core.devices

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** One line of a device log stream: a structured entry when stdout carried one, else the raw text. */
data class DebugLogEntry(
  val id: Int,
  val level: Level?,
  val message: String,
  val timestamp: String?,
  /** `metro`, `device` or `console` for a structured entry. */
  val origin: String?,
  val stackTrace: String?,
  val source: Source,
  val raw: String,
) {
  enum class Level { Verbose, Debug, Log, Info, Warning, Error }
  enum class Source { Stdout, Stderr }

  val isError: Boolean get() = level?.let { it == Level.Error || it == Level.Warning } ?: (source == Source.Stderr)

  /** `HH:mm:ss.SSS`, dropping the date and zone simctl's timestamps carry. */
  val clockTime: String? get() {
    val timestamp = timestamp ?: return null
    return CLOCK.find(timestamp)?.value ?: timestamp
  }

  fun matches(needle: String): Boolean {
    val n = needle.trim().lowercase()
    return n.isEmpty() || "$message ${stackTrace ?: ""}".lowercase().contains(n)
  }

  private companion object { val CLOCK = Regex("""\d{2}:\d{2}:\d{2}(\.\d{1,3})?""") }
}

/** Chunks split into lines, JSON entries from stdout recognised, the oldest dropped past [limit]. */
class DebugLog(val limit: Int = 2000) {
  var entries: List<DebugLogEntry> = emptyList()
    private set
  private var nextId = 1
  /** A chunk's unfinished last line, per stream, until the rest arrives. */
  private val partial = mutableMapOf<DebugLogEntry.Source, String>()

  fun append(chunk: String, source: DebugLogEntry.Source) {
    var text = (partial.remove(source) ?: "") + chunk
    if (text.isNotEmpty() && !text.last().isNewline()) {
      val cut = text.indexOfLast { it.isNewline() } + 1
      partial[source] = text.substring(cut)
      text = text.substring(0, cut)
    }
    val added = mutableListOf<DebugLogEntry>()
    for (line in text.split('\n', '\r').filter { it.isNotEmpty() }) {
      val parsed = if (source == DebugLogEntry.Source.Stdout) structured(line) else null
      added += parsed?.copy(id = nextId) ?: DebugLogEntry(nextId, null, line, null, null, null, source, line)
      nextId += 1
    }
    entries = (entries + added).takeLast(limit)
  }

  fun clear() {
    entries = emptyList()
    partial.clear()
  }

  @Serializable
  private class Line(
    val level: String? = null,
    val message: String? = null,
    val source: String? = null,
    val stackTrace: String? = null,
    val status: String? = null,
    val timestamp: String? = null,
  )

  companion object {
    private val json = Json { ignoreUnknownKeys = true }
    private val levels = mapOf(
      "verbose" to DebugLogEntry.Level.Verbose, "debug" to DebugLogEntry.Level.Debug, "log" to DebugLogEntry.Level.Log,
      "info" to DebugLogEntry.Level.Info, "warn" to DebugLogEntry.Level.Warning, "warning" to DebugLogEntry.Level.Warning,
      "error" to DebugLogEntry.Level.Error,
    )

    private fun Char.isNewline() = this == '\n' || this == '\r'

    internal fun structured(text: String): DebugLogEntry? {
      if (!text.startsWith("{")) return null
      val line = runCatching { json.decodeFromString(Line.serializer(), text) }.getOrNull() ?: return null
      if (line.status == "error") return null
      val message = line.message ?: return null
      val timestamp = line.timestamp ?: return null
      val origin = line.source?.takeIf { it in setOf("metro", "device", "console") }
      return DebugLogEntry(
        0, levels[line.level ?: "log"] ?: DebugLogEntry.Level.Log, message, timestamp, origin, line.stackTrace,
        DebugLogEntry.Source.Stdout, text,
      )
    }
  }
}
