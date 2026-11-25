package dev.houwert.argus.ui.composer

import dev.houwert.argus.kit.json.stringValue
import kotlinx.serialization.json.JsonElement

/** What voice mode says aloud and how it reads what it hears back. Pure, so it's tested without audio. */
object SpokenText {
  /** Replies past this are cut at a sentence and the rest left on screen. */
  const val REPLY_LIMIT = 1200

  const val REPEAT_ANSWER = "Say allow or deny."

  enum class Answer { Allow, Deny }

  /** A reply as speech: code and tables skipped, markdown dropped, links named rather than spelled out. */
  fun reply(markdown: String): String {
    val sentences = mutableListOf<String>()
    var inFence = false
    var skippedCode = false
    var skippedTable = false
    for (raw in markdown.lines()) {
      val line = raw.trim()
      if (line.startsWith("```") || line.startsWith("~~~")) {
        if (!inFence && !skippedCode) {
          sentences += "Code is on screen."
          skippedCode = true
        }
        inFence = !inFence
        continue
      }
      if (inFence) continue
      if (line.startsWith("|")) {
        if (!skippedTable) sentences += "A table is on screen."
        skippedTable = true
        continue
      }
      skippedTable = false
      val spoken = inline(stripBlockMarkers(line))
      if (spoken.isEmpty()) continue
      // A list item or heading reads as its own sentence.
      sentences += if (spoken.last() in ".!?:") spoken else "$spoken."
    }
    return truncated(sentences.joinToString(" "))
  }

  /** A permission prompt, ending in the question voice mode listens for the answer to. */
  fun permission(name: String, input: Map<String, JsonElement>): String =
    "The agent wants to ${action(name, input)}. Allow or deny?"

  /** A prompt voice mode can't answer: a question, a plan or a secret. */
  fun onScreen(title: String): String = "$title. It's on screen."

  private val allowWords = setOf(
    "allow", "allowed", "yes", "yeah", "yep", "approve", "approved", "ok", "okay", "sure", "go ahead", "do it",
    "allow it", "yes please", "accept",
  )
  private val denyWords = setOf(
    "deny", "denied", "no", "nope", "reject", "don't", "dont", "do not", "decline", "stop", "deny it", "no thanks",
    "cancel",
  )

  /** The whole utterance must be the answer, so a sentence that merely contains "no" isn't one. */
  fun answer(transcript: String): Answer? {
    val said = words(transcript).joinToString(" ")
    return when (said) {
      in allowWords -> Answer.Allow
      in denyWords -> Answer.Deny
      else -> null
    }
  }

  /** The words heard that the speaker didn't just say: with no echo cancellation the microphone hears the reply too. */
  fun novelWords(transcript: String, spoken: String): List<String> {
    val echo = words(spoken).toSet()
    return words(transcript).filterNot { it in echo }
  }

  /** How many of the transcript's first words are the reply's own, heard back through the microphone. */
  fun echoLength(transcript: String, spoken: String): Int {
    val echo = words(spoken).toSet()
    val parts = parts(transcript)
    val first = parts.indexOfFirst { normalized(it) !in echo }
    return if (first < 0) parts.size else first
  }

  /** The transcript past its first `count` words. */
  fun dropping(count: Int, transcript: String): String = parts(transcript).drop(count).joinToString(" ")

  internal fun words(text: String): List<String> = parts(text).map(::normalized).filter { it.isNotEmpty() }

  private val whitespace = Regex("\\s+")

  private fun parts(text: String): List<String> = text.split(whitespace).filter { it.isNotEmpty() }

  private fun normalized(word: String): String =
    word.lowercase().replace('’', '\'').trim { it != '\'' && isPunctuation(it) }

  private fun isPunctuation(char: Char): Boolean = when (Character.getType(char).toByte()) {
    Character.CONNECTOR_PUNCTUATION, Character.DASH_PUNCTUATION, Character.START_PUNCTUATION,
    Character.END_PUNCTUATION, Character.INITIAL_QUOTE_PUNCTUATION, Character.FINAL_QUOTE_PUNCTUATION,
    Character.OTHER_PUNCTUATION -> true
    else -> false
  }

  private fun action(name: String, input: Map<String, JsonElement>): String {
    fun file(): String =
      (input["file_path"].stringValue ?: input["notebook_path"].stringValue)?.trimEnd('/')?.substringAfterLast('/') ?: "a file"
    return when (name) {
      "Bash" -> {
        val command = input["command"].stringValue?.trim()
        when {
          command.isNullOrEmpty() -> "run a command"
          command.length <= 80 && '\n' !in command -> "run $command"
          else -> "run a long command"
        }
      }
      "Edit", "MultiEdit", "NotebookEdit" -> "edit ${file()}"
      "Write" -> "write ${file()}"
      "Read" -> "read ${file()}"
      "WebFetch" -> "fetch a web page"
      "WebSearch" -> "search the web"
      else -> {
        // `mcp__server__tool` reads as its tool.
        val tool = if (name.startsWith("mcp__")) name.split('_').lastOrNull { it.isNotEmpty() }.orEmpty() else name
        "use ${tool.ifEmpty { name }}"
      }
    }
  }

  private val numbered = Regex("^\\d+\\.")

  private fun stripBlockMarkers(line: String): String {
    var text = line.trimStart('#', '>')
    text = when {
      text.startsWith("- [ ] ") || text.startsWith("- [x] ") -> text.drop(6)
      text.startsWith("- ") || text.startsWith("* ") || text.startsWith("+ ") -> text.drop(2)
      else -> text
    }
    text = text.replaceFirst(numbered, "").trim()
    // A horizontal rule says nothing.
    return if (text.all { it in "-*_" }) "" else text
  }

  private val link = Regex("!?\\[([^\\]]*)\\]\\([^)]*\\)")
  private val url = Regex("https?://\\S+")
  private val emphasis = Regex("(\\*\\*|__|\\*|_|~~|`)")

  private fun inline(text: String): String =
    // [label](url) reads as its label; a bare URL as "a link".
    text.replace(link, "$1").replace(url, "a link").replace(emphasis, "").replace(whitespace, " ").trim()

  private fun truncated(text: String): String {
    if (text.length <= REPLY_LIMIT) return text
    val head = text.take(REPLY_LIMIT)
    val end = head.indexOfLast { it in ".!?" }
    val cut = if (end >= 0) head.substring(0, end + 1) else head
    return "$cut The rest is on screen."
  }
}
