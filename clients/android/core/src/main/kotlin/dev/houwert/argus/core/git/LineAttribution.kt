package dev.houwert.argus.core.git

import dev.houwert.argus.kit.protocol.generated.AttributedRangeAuthor
import dev.houwert.argus.kit.util.DiffFile
import dev.houwert.argus.kit.util.DiffLineKind
import dev.houwert.argus.kit.protocol.generated.LineAttribution as WireLineAttribution

/** Who wrote a line: an agent's edit tool call, or a person who changed it afterwards. */
enum class LineAuthor { AGENT, HUMAN }

/** Marked lines of a session's files as the worktree has them now, by path, then 1-based line. */
data class LineAttribution(val files: Map<String, Map<Int, LineAuthor>> = emptyMap()) {
  fun lines(path: String): Map<Int, LineAuthor> = files[path].orEmpty()

  companion object {
    fun of(wire: WireLineAttribution) = LineAttribution(
      wire.files.associate { file ->
        file.path to buildMap {
          for (range in file.ranges) {
            val author = if (range.author == AttributedRangeAuthor.human) LineAuthor.HUMAN else LineAuthor.AGENT
            for (line in range.start.toInt()..range.end.toInt()) put(line, author)
          }
        }
      },
    )

    /** Only the working copy and the branch end at the tree as it is now, which is what the lines number. */
    fun appliesToDiffMode(mode: String) = mode == "working" || mode == "branch"

    /** For telemetry: how many files carry marks, bucketed. */
    fun filesBucket(count: Int) = when {
      count <= 0 -> "0"
      count == 1 -> "1"
      count <= 5 -> "2-5"
      count <= 20 -> "6-20"
      else -> "21+"
    }
  }
}

/** How many of a set of lines each author wrote. */
data class AttributionCounts(val agent: Int = 0, val human: Int = 0) {
  val isEmpty get() = agent == 0 && human == 0

  companion object {
    fun of(marks: Map<Int, LineAuthor>, lines: Iterable<Int>): AttributionCounts {
      var agent = 0
      var human = 0
      for (line in lines) when (marks[line]) {
        LineAuthor.AGENT -> agent++
        LineAuthor.HUMAN -> human++
        null -> {}
      }
      return AttributionCounts(agent, human)
    }
  }
}

/** Its added lines' numbers on the new side, the ones attribution marks. */
val DiffFile.addedLineNumbers: List<Int>
  get() = hunks.flatMap { it.lines }.mapNotNull { if (it.kind == DiffLineKind.ADD) it.newNumber else null }
