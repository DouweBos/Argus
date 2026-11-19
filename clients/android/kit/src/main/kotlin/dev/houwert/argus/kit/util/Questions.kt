package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.json.arrayValue
import dev.houwert.argus.kit.json.boolValue
import dev.houwert.argus.kit.json.objectValue
import dev.houwert.argus.kit.json.stringValue
import kotlinx.serialization.json.JsonElement

/**
 * The `AskUserQuestion` payload and the answer format the agent expects. The answer travels as a
 * deny carrying a message, so its wording is a contract with the desktop and must stay byte-identical.
 */
object Questions {
  data class Option(val label: String, val description: String? = null) {
    val id: String get() = label
  }

  data class Question(
    val question: String,
    val header: String?,
    val options: List<Option>,
    val multiSelect: Boolean,
  ) {
    val id: String get() = header ?: question
  }

  /** A question's recovered selections. */
  data class Answer(val picks: List<String>, val note: String?)

  /** The synthetic "type your own answer" row. */
  const val CUSTOM_KEY = "__argus_custom__"

  fun parse(input: Map<String, JsonElement>): List<Question>? {
    val raw = input["questions"].arrayValue ?: return null
    val questions = raw.mapNotNull { entry ->
      val fields = entry.objectValue ?: return@mapNotNull null
      val text = fields["question"].stringValue ?: return@mapNotNull null
      val options = fields["options"].arrayValue.orEmpty().mapNotNull { option ->
        val label = option.objectValue?.get("label").stringValue ?: return@mapNotNull null
        Option(label, option.objectValue?.get("description").stringValue)
      }
      Question(text, fields["header"].stringValue, options, fields["multiSelect"].boolValue ?: false)
    }
    return questions.ifEmpty { null }
  }

  /** The answer exactly as the desktop's QuestionForm assembles it. */
  fun formatAnswer(questions: List<Question>, picks: Map<Int, List<String>>, custom: Map<Int, String>): String {
    val lines = mutableListOf("The user answered:")
    questions.forEachIndexed { index, question ->
      val picked = picks[index].orEmpty()
      val chosen = picked.filter { it != CUSTOM_KEY }
      val usesCustom = picked.contains(CUSTOM_KEY)
      val note = custom[index].orEmpty().trim()
      val parts = mutableListOf<String>()
      if (chosen.isNotEmpty()) parts.add(chosen.joinToString(", "))
      if (usesCustom && note.isNotEmpty()) parts.add(if (chosen.isEmpty()) note else "note: $note")
      lines.add("- ${question.header ?: question.question}: ${parts.joinToString(" — ")}")
    }
    return lines.joinToString("\n")
  }

  /** The selections recovered from a formatted answer, so an answered question renders as ticks. */
  fun parseAnswer(text: String, questions: List<Question>): Map<Int, Answer> {
    val result = mutableMapOf<Int, Answer>()
    for (line in text.split("\n").drop(1)) {
      val colon = line.indexOf(':')
      if (!line.startsWith("- ") || colon < 0) continue
      val header = line.substring(2, maxOf(2, colon)).trimSpaces()
      val index = questions.indexOfFirst { (it.header ?: it.question) == header }
      if (index < 0) continue

      var remainder = line.substring(colon + 1).trimSpaces()
      // Longest label first, so "Yes, always" isn't eaten by "Yes".
      val picks = mutableListOf<String>()
      for (option in questions[index].options.sortedByDescending { it.label.length }) {
        if (remainder.contains(option.label)) {
          picks.add(option.label)
          remainder = remainder.replace(option.label, "")
        }
      }
      val note = remainder.replace("note:", "").trim { it in " ,—-" }
      result[index] = Answer(questions[index].options.map { it.label }.filter { it in picks }, note.ifEmpty { null })
    }
    return result
  }
}

/** Canned replies the agent receives, byte-identical to the desktop so it sees one wording from any client. */
object CannedReply {
  const val CANCEL_QUESTION =
    "The user cancelled the question prompt without answering. Proceed with reasonable assumptions and note them."

  const val KEEP_PLANNING =
    "The user rejected the plan and wants to keep refining it. Incorporate their feedback once provided."

  const val PLAN_HANDOFF =
    "The user approved this plan but handed it off to a new session to implement. Do not implement it here — " +
      "stay in plan mode and wait for further instructions."

  fun planFeedback(feedback: String): String =
    "The user wants to refine the plan before approving it. Their feedback:\n\n$feedback\n\n" +
      "Incorporate this feedback and propose an updated plan via ExitPlanMode."
}
