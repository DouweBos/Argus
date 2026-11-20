package dev.houwert.argus.kit.util

// Unified-diff parsing for the Changes screen, ported from `diff.ts`.

enum class DiffLineKind { CONTEXT, ADD, REMOVE, NO_NEWLINE }

data class DiffLine(
  val kind: DiffLineKind,
  val text: String,
  val oldNumber: Int?,
  val newNumber: Int?,
  val id: Int,
)

data class DiffHunk(val header: String, val lines: List<DiffLine>) {
  val id: String get() = header
}

enum class DiffFileStatus(val rawValue: String) {
  ADDED("A"),
  DELETED("D"),
  MODIFIED("M"),
  RENAMED("R");

  val label: String get() = name.lowercase()
}

data class DiffFile(
  val oldPath: String,
  val newPath: String,
  val status: DiffFileStatus,
  val hunks: List<DiffHunk>,
  val isBinary: Boolean,
) {
  val id: String get() = displayPath
  val displayPath: String get() = newPath.ifEmpty { oldPath }
  val additions: Int get() = hunks.sumOf { hunk -> hunk.lines.count { it.kind == DiffLineKind.ADD } }
  val deletions: Int get() = hunks.sumOf { hunk -> hunk.lines.count { it.kind == DiffLineKind.REMOVE } }
}

object DiffParser {
  /** Unquote a path git chose to escape (spaces, non-ASCII). */
  internal fun unquote(raw: String): String {
    val path = raw.trimSpaces()
    if (!(path.length >= 2 && path.startsWith("\"") && path.endsWith("\""))) return path
    return path.substring(1, path.length - 1).replace("\\\"", "\"").replace("\\\\", "\\")
  }

  /** `diff --git a/x b/y`: the fallback when there are no `---`/`+++` lines, as for a pure rename or a binary. */
  internal fun pathsFromGitLine(line: String): Pair<String, String> {
    val trimmed = line.trimSpaces()
    if (trimmed.startsWith("\"")) {
      // Both paths quoted: "a/one two" "b/three four"
      val parts = trimmed.split("\" \"")
      if (parts.size == 2) {
        return unquote(parts[0] + "\"").removePrefix("a/") to unquote("\"" + parts[1]).removePrefix("b/")
      }
      return "" to ""
    }
    val split = trimmed.indexOf(" b/")
    if (!trimmed.startsWith("a/") || split < 0) return "" to ""
    return trimmed.substring(2, split) to trimmed.substring(split + 3)
  }

  internal fun stripPrefix(line: String, marker: String, pathPrefix: String): String {
    val value = line.drop(marker.length).removePrefix(pathPrefix)
    return if (value == "/dev/null") "" else unquote(value)
  }

  fun parse(raw: String): List<DiffFile> {
    val chunks = raw.split("\ndiff --git ")
    val normalized = mutableListOf<String>()
    chunks.forEachIndexed { index, chunk ->
      var body = chunk
      if (index == 0) {
        if (!body.startsWith("diff --git ")) return@forEachIndexed
        body = body.removePrefix("diff --git ")
      }
      normalized.add(body)
    }
    return normalized.map(::parseFile)
  }

  private fun parseFile(chunk: String): DiffFile {
    val lines = chunk.split("\n")
    var oldPath = ""
    var newPath = ""
    var bodyStart = 0
    var isBinary = false

    for ((index, line) in lines.withIndex()) {
      if (line.startsWith("--- ")) {
        oldPath = stripPrefix(line, "--- ", "a/")
      } else if (line.startsWith("+++ ")) {
        newPath = stripPrefix(line, "+++ ", "b/")
        bodyStart = index + 1
        break
      }
    }

    if (oldPath.isEmpty() && newPath.isEmpty()) {
      val (old, new) = pathsFromGitLine(lines.firstOrNull() ?: "")
      oldPath = old
      newPath = new
    }

    var renameFrom = ""
    var renameTo = ""
    for (line in lines) {
      when {
        line.startsWith("rename from ") -> renameFrom = unquote(line.removePrefix("rename from "))
        line.startsWith("rename to ") -> renameTo = unquote(line.removePrefix("rename to "))
        line.startsWith("Binary files ") || line.startsWith("GIT binary patch") -> isBinary = true
      }
    }
    if (oldPath.isEmpty() && renameFrom.isNotEmpty()) oldPath = renameFrom
    if (newPath.isEmpty() && renameTo.isNotEmpty()) newPath = renameTo

    val status = when {
      oldPath.isEmpty() -> DiffFileStatus.ADDED
      newPath.isEmpty() -> DiffFileStatus.DELETED
      oldPath != newPath -> DiffFileStatus.RENAMED
      else -> DiffFileStatus.MODIFIED
    }

    val hunks = mutableListOf<DiffHunk>()
    var header: String? = null
    var current = mutableListOf<DiffLine>()
    var nextOld = 0
    var nextNew = 0
    var oldLeft = 0
    var newLeft = 0
    var lineId = 0

    for (line in lines.drop(bodyStart)) {
      val range = hunkRange(line)
      if (range != null) {
        header?.let { hunks.add(DiffHunk(it, current)) }
        header = line
        current = mutableListOf()
        nextOld = range.old
        nextNew = range.new
        oldLeft = range.oldCount
        newLeft = range.newCount
        continue
      }
      if (header == null) continue
      // A bare empty line is blank context only while the header still expects lines; past that it is
      // the diff's own trailing newline.
      if (line.isEmpty() && (oldLeft <= 0 || newLeft <= 0)) continue
      lineId += 1
      when {
        line.startsWith("+") -> {
          current.add(DiffLine(DiffLineKind.ADD, line.drop(1), null, nextNew, lineId))
          nextNew += 1
          newLeft -= 1
        }
        line.startsWith("-") -> {
          current.add(DiffLine(DiffLineKind.REMOVE, line.drop(1), nextOld, null, lineId))
          nextOld += 1
          oldLeft -= 1
        }
        line.startsWith(" ") || line.isEmpty() -> {
          current.add(DiffLine(DiffLineKind.CONTEXT, line.drop(1), nextOld, nextNew, lineId))
          nextOld += 1
          nextNew += 1
          oldLeft -= 1
          newLeft -= 1
        }
        // "\ No newline at end of file" attaches to the line before rather than taking a numbered slot.
        line.startsWith("\\") -> current.add(DiffLine(DiffLineKind.NO_NEWLINE, line.drop(2), null, null, lineId))
      }
    }
    header?.let { hunks.add(DiffHunk(it, current)) }
    return DiffFile(oldPath, newPath, status, hunks, isBinary)
  }

  internal data class HunkRange(val old: Int, val oldCount: Int, val new: Int, val newCount: Int)

  private val hunkHeader = Regex("""^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@""")

  /** `@@ -a,b +c,d @@` to starts and counts; an omitted count is 1. */
  internal fun hunkRange(header: String): HunkRange? {
    if (!header.startsWith("@@ -")) return null
    val match = hunkHeader.find(header) ?: return null
    val (old, oldCount, new, newCount) = match.destructured
    return HunkRange(
      old.toIntOrNull() ?: return null,
      oldCount.ifEmpty { "1" }.toIntOrNull() ?: return null,
      new.toIntOrNull() ?: return null,
      newCount.ifEmpty { "1" }.toIntOrNull() ?: return null,
    )
  }
}
