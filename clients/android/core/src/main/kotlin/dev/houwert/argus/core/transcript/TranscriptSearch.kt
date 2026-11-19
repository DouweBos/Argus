package dev.houwert.argus.core.transcript

/**
 * Find-in-chat over what the transcript renders. Matches the desktop's rules: trimmed query,
 * case-insensitive, non-overlapping, wrapping navigation.
 */
object TranscriptSearch {
  /** One searchable piece of the transcript (a message's text, a tool call's summary) under an id the view can scroll to. */
  data class Unit(val id: String, val text: String)

  data class Hit(val unitId: String, val range: TextRange)

  fun find(query: String, units: List<Unit>): List<Hit> {
    val needle = query.trim()
    if (needle.isEmpty()) return emptyList()
    val hits = mutableListOf<Hit>()
    for (unit in units) {
      var from = 0
      while (from < unit.text.length) {
        val found = unit.text.indexOf(needle, from, ignoreCase = true)
        if (found < 0) break
        hits.add(Hit(unit.id, TextRange(found, needle.length)))
        from = found + needle.length
      }
    }
    return hits
  }

  /** The next (or previous) hit from [current], wrapping at either end. */
  fun step(current: Int?, count: Int, forward: Boolean): Int? {
    if (count <= 0) return null
    if (current == null) return if (forward) 0 else count - 1
    return (current + (if (forward) 1 else -1) + count) % count
  }

  /** "3 of 12", "No matches", or nothing while the query is empty. */
  fun counter(query: String, count: Int, current: Int?): String {
    if (query.isBlank()) return ""
    if (count <= 0) return "No matches"
    return "${(current ?: 0) + 1} of $count"
  }
}
