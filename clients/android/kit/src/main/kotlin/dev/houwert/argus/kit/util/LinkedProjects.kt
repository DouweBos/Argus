package dev.houwert.argus.kit.util

/**
 * The preamble that carries linked projects with a message. Byte-identical to
 * the desktop's `linkedProjectsPreamble`; the head is a live instruction to the
 * agent, so editing it changes behaviour, not just formatting.
 */
object LinkedProjects {
  internal const val HEAD =
    "[Linked project directories — the user has explicitly attached the " +
      "following project roots to this chat. You are allowed to read from and " +
      "make changes in these directories in addition to your own worktree, but " +
      "you MUST NOT switch branches, check out other refs, or otherwise alter " +
      "the git state of these roots — they are shared with the user's other " +
      "work. If you need to silo changes on a separate branch in one of these " +
      "projects, use the Argus MCP `create_session` (or `spawn_agent`) tool to " +
      "open a new session in that project instead of switching branches here:"

  fun buildPreamble(paths: List<String>, message: String): String {
    if (paths.isEmpty()) return message
    val lines = paths.joinToString("\n") { "- $it" }
    return "$HEAD\n$lines]\n\n$message"
  }

  data class Parsed(val paths: List<String>, val rest: String)

  /** The preamble stripped so a transcript can show chips; null when the text doesn't start with it. */
  fun parsePreamble(text: String): Parsed? {
    if (!text.startsWith(HEAD)) return null
    val afterHead = text.substring(HEAD.length)
    val close = afterHead.indexOf(']').takeIf { it >= 0 } ?: return null
    val paths = afterHead.substring(0, close).split("\n")
      .map { it.trim() }
      .filter { it.startsWith("- ") }
      .map { it.removePrefix("- ").trim() }
    if (paths.isEmpty()) return null
    return Parsed(paths, afterHead.substring(close + 1).trimStart('\n'))
  }
}
