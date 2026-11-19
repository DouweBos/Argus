package dev.houwert.argus.core.code

/**
 * Quick-open matching over a session's relative paths, fzf style: the query is a case-insensitive
 * subsequence of the path; matches in the file name, at word boundaries (`/`, `_`, `-`, `.`,
 * camelCase) and in runs score higher. Build once per file list, then [search] per keystroke.
 */
class FuzzyFileMatcher(val paths: List<String>) {
  data class Match(
    val path: String,
    val score: Long,
    /** UTF-16 offsets into [path] of the matched characters, for highlighting. */
    val indices: List<Int>,
    val isBoosted: Boolean,
  )

  /** Offset of each path's file name within it. */
  private val baseOffsets = IntArray(paths.size) { paths[it].lastIndexOf('/') + 1 }

  /**
   * Best matches first, at most [limit]. Paths in [boost] (changed files) rank above the rest. An
   * empty query lists boosted paths first, then the others in their original order.
   */
  fun search(query: String, boost: Set<String> = emptySet(), limit: Int = 50): List<Match> {
    val needle = fold(query.filter { it != ' ' })
    if (needle.isEmpty()) {
      val boosted = paths.filter { it in boost }
      val rest = paths.asSequence().filter { it !in boost }.take(maxOf(0, limit - boosted.size))
      return (boosted + rest).take(limit).map { Match(it, 0, emptyList(), it in boost) }
    }
    val scored = ArrayList<Pair<Int, Long>>()
    for (index in paths.indices) {
      var score = score(needle, paths[index], baseOffsets[index])?.first ?: continue
      if (boost.isNotEmpty() && paths[index] in boost) score += BOOST_BONUS
      scored += index to score
    }
    scored.sortWith(compareByDescending<Pair<Int, Long>> { it.second }.thenBy { it.first })
    return scored.take(limit).map { (index, score) ->
      val path = paths[index]
      Match(path, score, score(needle, path, baseOffsets[index])?.second.orEmpty(), score >= BOOST_BONUS)
    }
  }

  companion object {
    private const val BOOST_BONUS = 1L shl 40

    /** One path against one query, for callers that don't keep an index. */
    fun match(query: String, path: String): Pair<Long, List<Int>>? =
      score(fold(query.filter { it != ' ' }), path, path.lastIndexOf('/') + 1)

    private fun score(needle: String, path: String, baseOffset: Int): Pair<Long, List<Int>>? {
      if (needle.isEmpty()) return 0L to emptyList()
      // A match inside the file name beats the same letters spread over directories.
      if (baseOffset > 0) {
        window(needle, path, baseOffset)?.let { inName ->
          val indices = pick(needle, path, inName)
          return rate(indices, path, baseOffset) to indices
        }
      }
      val whole = window(needle, path, 0) ?: return null
      val indices = pick(needle, path, whole)
      return rate(indices, path, baseOffset) to indices
    }

    /** The shortest stretch ending at the first complete match (fzf's v1 forward/backward scan). */
    private fun window(needle: String, path: String, start: Int): IntRange? {
      var j = 0
      var end = -1
      var i = start
      while (i < path.length) {
        if (fold(path[i]) == needle[j]) {
          j += 1
          if (j == needle.length) {
            end = i
            break
          }
        }
        i += 1
      }
      if (end < 0) return null
      j = needle.length - 1
      var begin = end
      while (begin >= start) {
        if (fold(path[begin]) == needle[j]) {
          if (j == 0) break
          j -= 1
        }
        begin -= 1
      }
      return begin..end
    }

    private fun pick(needle: String, path: String, window: IntRange): List<Int> {
      val indices = ArrayList<Int>(needle.length)
      var j = 0
      for (i in window) {
        if (j < needle.length && fold(path[i]) == needle[j]) {
          indices += i
          j += 1
        }
      }
      return indices
    }

    private fun rate(indices: List<Int>, path: String, baseOffset: Int): Long {
      var score = 0L
      var previous = -2
      var streak = 0
      for (index in indices) {
        score += 16
        score += boundaryBonus(index, path)
        if (index == previous + 1) {
          streak += 1
          score += 4 * minOf(streak, 4)
        } else {
          streak = 0
          if (previous >= 0) score -= minOf(index - previous - 1, 12)
        }
        previous = index
      }
      val first = indices.firstOrNull()
      if (first != null && first >= baseOffset) {
        score += 24
        if (first == baseOffset) score += 12
        if (indices.size == path.length - baseOffset) score += 24
      }
      // Ties go to the shorter path.
      return score * 1024 - path.length
    }

    private fun boundaryBonus(index: Int, path: String): Int {
      if (index == 0) return 10
      return when (val previous = path[index - 1]) {
        '/' -> 10
        '_', '-', '.', ' ' -> 8
        else -> if (previous in 'a'..'z' && path[index] in 'A'..'Z') 7 else 0
      }
    }

    private fun fold(c: Char): Char = if (c in 'A'..'Z') c + 32 else c

    private fun fold(s: String): String = buildString(s.length) { s.forEach { append(fold(it)) } }
  }
}
