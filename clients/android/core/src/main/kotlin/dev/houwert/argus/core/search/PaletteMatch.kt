package dev.houwert.argus.core.search

/**
 * Fuzzy matching as the Mac's command palette does it (`PaletteMatch` in ArgusCore): every query
 * character in order, word starts and runs scoring higher, a contiguous run above all.
 */
object PaletteMatch {
  /** Null when the query doesn't match; higher is better. */
  fun score(query: String, text: String): Int? {
    val needle = query.lowercase().filter { !it.isWhitespace() }
    if (needle.isEmpty()) return 0
    val haystack = text.lowercase()
    var score = 0
    var index = 0
    var previous = -1
    for (char in needle) {
      val found = haystack.indexOf(char, index)
      if (found < 0) return null
      val atWordStart = found == 0 || !haystack[found - 1].isLetterOrDigit()
      score += if (atWordStart) 10 else 1
      if (previous >= 0 && previous + 1 == found) score += 5
      previous = found
      index = found + 1
    }
    val start = haystack.indexOf(needle)
    if (start >= 0) score += if (start == 0 || !haystack[start - 1].isLetter()) 60 else 30
    // Shorter titles win ties: the match covers more of them.
    return score * 100 - haystack.length
  }

  /** [items] ranked by their best-scoring text, unmatched ones dropped; an empty query keeps the order. */
  fun <T> rank(items: List<T>, query: String, texts: (T) -> List<String>): List<T> {
    if (query.isBlank()) return items
    return items.withIndex()
      .mapNotNull { (offset, item) -> texts(item).mapNotNull { score(query, it) }.maxOrNull()?.let { Triple(item, it, offset) } }
      .sortedWith(compareByDescending<Triple<T, Int, Int>> { it.second }.thenBy { it.third })
      .map { it.first }
  }
}
