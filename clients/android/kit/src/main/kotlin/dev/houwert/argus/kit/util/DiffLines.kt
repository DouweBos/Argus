package dev.houwert.argus.kit.util

/**
 * Inline Edit/Write previews inside a tool call, ported from `diffLines.ts`. Not a real diff: it matches
 * the shared prefix and suffix and treats the middle as replaced, which is what an Edit call did.
 */
object InlineDiff {
  data class Stats(val additions: Int, val deletions: Int)

  /** A final newline terminates the last line rather than starting another. */
  internal fun lines(text: String): List<String> {
    if (text.isEmpty()) return emptyList()
    val lines = text.split("\n")
    return if (lines.size > 1 && lines.last().isEmpty()) lines.dropLast(1) else lines
  }

  internal fun matchEdges(old: List<String>, new: List<String>): Pair<Int, Int> {
    val limit = minOf(old.size, new.size)
    var prefix = 0
    while (prefix < limit && old[prefix] == new[prefix]) prefix += 1
    var suffix = 0
    while (suffix < limit - prefix && old[old.size - 1 - suffix] == new[new.size - 1 - suffix]) suffix += 1
    return prefix to suffix
  }

  fun compute(old: String, new: String): List<DiffLine> {
    val oldLines = lines(old)
    val newLines = lines(new)
    val (prefix, suffix) = matchEdges(oldLines, newLines)
    val out = mutableListOf<DiffLine>()
    fun append(kind: DiffLineKind, text: String, oldNo: Int?, newNo: Int?) {
      out.add(DiffLine(kind, text, oldNo, newNo, out.size + 1))
    }
    for (i in 0 until prefix) append(DiffLineKind.CONTEXT, oldLines[i], i + 1, i + 1)
    for (i in prefix until oldLines.size - suffix) append(DiffLineKind.REMOVE, oldLines[i], i + 1, null)
    for (i in prefix until newLines.size - suffix) append(DiffLineKind.ADD, newLines[i], null, i + 1)
    for (i in 0 until suffix) {
      val oldIndex = oldLines.size - suffix + i
      val newIndex = newLines.size - suffix + i
      append(DiffLineKind.CONTEXT, oldLines[oldIndex], oldIndex + 1, newIndex + 1)
    }
    return out
  }

  /** A Write is all additions; there was nothing there before. */
  fun writeLines(content: String): List<DiffLine> =
    lines(content).mapIndexed { index, text -> DiffLine(DiffLineKind.ADD, text, null, index + 1, index + 1) }

  fun stats(old: String, new: String): Stats {
    val oldLines = lines(old)
    val newLines = lines(new)
    val (prefix, suffix) = matchEdges(oldLines, newLines)
    return Stats(maxOf(0, newLines.size - prefix - suffix), maxOf(0, oldLines.size - prefix - suffix))
  }

  fun writeStats(content: String): Stats = Stats(lines(content).size, 0)
}
