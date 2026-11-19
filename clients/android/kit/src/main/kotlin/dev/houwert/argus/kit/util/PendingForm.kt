package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.json.stringValue
import kotlinx.serialization.json.JsonElement

/**
 * Which inline form a call awaiting a decision gets. The form owns the call's input (the question
 * form shows the questions, plan approval the plan), so the card above must not print it again.
 */
sealed interface PendingForm {
  data object Buttons : PendingForm
  data class Plan(val plan: String) : PendingForm
  data class Question(val questions: List<Questions.Question>) : PendingForm
  data class Secret(val request: SecretRequest) : PendingForm

  /** True when the form renders the call's input itself. */
  val ownsInput: Boolean get() = this != Buttons

  companion object {
    fun of(name: String, input: Map<String, JsonElement>): PendingForm {
      SecretRequest.parse(name, input)?.let { return Secret(it) }
      if (name == "AskUserQuestion") Questions.parse(input)?.let { return Question(it) }
      if (name == "ExitPlanMode") input["plan"].stringValue?.let { return Plan(it) }
      return Buttons
    }
  }
}
