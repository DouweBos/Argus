package dev.houwert.argus.core.git

/** A commit message as the composer edits it: a one-line summary over an optional description. */
data class CommitMessage(val summary: String = "", val description: String = "") {
  val trimmedSummary get() = summary.trim()
  val hasDescription get() = description.isNotBlank()

  /** The message git gets: summary, a blank line, then the description. */
  val text: String
    get() {
      val body = description.trim()
      return if (body.isEmpty()) trimmedSummary else "$trimmedSummary\n\n$body"
    }

  val isEmpty get() = trimmedSummary.isEmpty()

  companion object {
    /** Splits a full message at its first line, as git reads a subject. */
    fun parse(message: String): CommitMessage {
      val trimmed = message.trim()
      val newline = trimmed.indexOf('\n')
      if (newline < 0) return CommitMessage(trimmed)
      return CommitMessage(trimmed.substring(0, newline).trim(), trimmed.substring(newline).trim())
    }
  }
}
