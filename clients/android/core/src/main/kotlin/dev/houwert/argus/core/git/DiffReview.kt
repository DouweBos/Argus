package dev.houwert.argus.core.git

import dev.houwert.argus.kit.util.DiffHunk
import dev.houwert.argus.kit.util.DiffLine
import dev.houwert.argus.kit.util.DiffLineKind
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** A draft comment on a diff line or run of lines, waiting to go to the agent as part of a review. */
data class DiffReviewComment(
  val id: String = UUID.randomUUID().toString(),
  val path: String,
  val side: Side,
  /** First and last line, inclusive. */
  val lines: IntRange,
  /** The commented lines' text, so the comment finds its lines again after the diff moves. */
  val excerpt: List<String>,
  /** The hunk as unified diff text, header first. */
  val hunk: String,
  /** What the diff compared: "uncommitted changes", "main...feature". */
  val scope: String,
  val body: String,
) {
  /** Which side of the diff the line numbers count: removed lines only exist on the old one. */
  enum class Side { Old, New }

  /** `src/app.ts:12` or `src/app.ts:12-18`, with `(removed)` for old-side lines. */
  val location: String
    get() {
      val range = if (lines.first == lines.last) "${lines.first}" else "${lines.first}-${lines.last}"
      return "$path:$range" + if (side == Side.Old) " (removed)" else ""
    }

  /** Whether this comment belongs on these lines of [path], as a diff now shows them. */
  fun anchors(path: String, side: Side, last: Int, text: String): Boolean =
    this.path == path && this.side == side && lines.last == last && excerpt.lastOrNull() == text

  /** Whether this comment hangs under [line] of a parsed diff of [path]. */
  fun anchors(path: String, line: DiffLine): Boolean {
    val side = if (line.kind == DiffLineKind.REMOVE) Side.Old else Side.New
    val number = (if (side == Side.Old) line.oldNumber else line.newNumber) ?: return false
    return anchors(path, side, number, line.text)
  }

  companion object {
    /** A draft on one line of a parsed diff (a line per tap); null for a "no newline" marker. */
    fun draft(path: String, hunk: DiffHunk, line: DiffLine, scope: String): DiffReviewComment? {
      if (line.kind == DiffLineKind.NO_NEWLINE) return null
      val side = if (line.kind == DiffLineKind.REMOVE) Side.Old else Side.New
      val number = (if (side == Side.Old) line.oldNumber else line.newNumber) ?: return null
      val text = (listOf(hunk.header) + hunk.lines.map { DiffReviewPrompt.sign(it.kind) + it.text }).joinToString("\n")
      return DiffReviewComment(path = path, side = side, lines = number..number, excerpt = listOf(line.text), hunk = text, scope = scope, body = "")
    }
  }
}

/** Draft review comments per session (or per pull request key). In memory only: a review is one sitting. */
class DiffReviewDrafts {
  private val _bySession = MutableStateFlow(emptyMap<String, List<DiffReviewComment>>())
  val bySession: StateFlow<Map<String, List<DiffReviewComment>>> = _bySession.asStateFlow()

  fun comments(sessionId: String): List<DiffReviewComment> = _bySession.value[sessionId].orEmpty()

  fun comments(sessionId: String, path: String): List<DiffReviewComment> = comments(sessionId).filter { it.path == path }

  fun add(comment: DiffReviewComment, sessionId: String) {
    _bySession.update { it + (sessionId to (it[sessionId].orEmpty() + comment)) }
  }

  fun update(id: String, body: String, sessionId: String) {
    _bySession.update { map ->
      val list = map[sessionId] ?: return@update map
      map + (sessionId to list.map { if (it.id == id) it.copy(body = body) else it })
    }
  }

  fun remove(id: String, sessionId: String) {
    _bySession.update { map ->
      val left = map[sessionId].orEmpty().filterNot { it.id == id }
      if (left.isEmpty()) map - sessionId else map + (sessionId to left)
    }
  }

  fun clear(sessionId: String) {
    _bySession.update { it - sessionId }
  }

  fun clearAll() {
    _bySession.value = emptyMap()
  }
}

/** The text a review becomes: one message for the agent, and the shorter one the transcript shows. */
object DiffReviewPrompt {
  fun message(comments: List<DiffReviewComment>): String {
    val out = StringBuilder("Please address my review comments on the diff. Each one quotes the hunk it is about.\n")
    sorted(comments).forEachIndexed { index, comment ->
      val fence = "`".repeat(maxOf(3, longestBacktickRun(comment.hunk) + 1))
      out.append("\n## ${index + 1}. ${comment.location}\n")
      out.append("In the ${comment.scope}:\n${fence}diff\n${comment.hunk}\n$fence\n\n${comment.body}\n")
    }
    return out.toString()
  }

  /** One line per comment, without the hunks. */
  fun displayText(comments: List<DiffReviewComment>): String {
    val files = comments.map { it.path }.toSet().size
    val head = "Review: ${plural(comments.size, "comment")} on ${plural(files, "file")}"
    return (listOf(head) + sorted(comments).map { "- ${it.location}: ${it.body}" }).joinToString("\n")
  }

  /** What a fresh agent is asked to review before a commit: the message and its display text. */
  fun reviewRequest(baseBranch: String?): Pair<String, String> {
    val scope = baseBranch?.let {
      "everything on this branch since it left `$it` (`git diff $it...HEAD`) plus any uncommitted changes (`git diff HEAD`)"
    } ?: "the uncommitted changes (`git diff HEAD`, and `git status` for new files)"
    val message = "Review the code before I commit it: $scope.\n" +
      "Look for bugs, edge cases, security problems, missing tests and code that doesn't match the codebase's conventions. " +
      "For each finding give the file and line, what's wrong and how to fix it, most severe first. " +
      "Don't edit any files; report only. Say so plainly if you find nothing worth changing."
    return message to "Review the code before I commit it"
  }

  fun plural(count: Int, noun: String): String = "$count $noun${if (count == 1) "" else "s"}"

  internal fun sign(kind: DiffLineKind): String = when (kind) {
    DiffLineKind.ADD -> "+"
    DiffLineKind.REMOVE -> "-"
    DiffLineKind.CONTEXT -> " "
    DiffLineKind.NO_NEWLINE -> "\\"
  }

  private fun sorted(comments: List<DiffReviewComment>) = comments.sortedWith(compareBy({ it.path }, { it.lines.first }))

  private fun longestBacktickRun(text: String): Int {
    var longest = 0
    var run = 0
    for (c in text) {
      run = if (c == '`') run + 1 else 0
      longest = maxOf(longest, run)
    }
    return longest
  }
}
