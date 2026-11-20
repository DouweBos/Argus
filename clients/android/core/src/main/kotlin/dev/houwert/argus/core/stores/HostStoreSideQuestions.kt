package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import kotlinx.coroutines.flow.update
import java.util.UUID

/** A question asked of an agent on a read-only fork of its context, and its answer. */
data class SideQuestion(
  val id: String,
  val question: String,
  val answer: String? = null,
  val error: String? = null,
  /** Promoted into the agent's own conversation. */
  val sent: Boolean = false,
) {
  val isPending: Boolean get() = answer == null && error == null
}

// Side questions: answered off a throwaway fork, so the agent's turn and
// transcript stay untouched until someone sends an answer to it.

suspend fun HostStore.askSide(agentId: String, question: String) {
  val text = question.trim()
  if (text.isEmpty()) return
  val id = UUID.randomUUID().toString()
  _sideQuestionsByAgent.update { it + (agentId to it[agentId].orEmpty() + SideQuestion(id, text)) }
  try {
    val backend = backend ?: throw TransportException.NotReady()
    val result = backend.request(Methods.AgentsAskSide, MethodsTypes.AgentsAskSideParams(agentId, text))
    updateSide(agentId, id) { it.copy(answer = result.answer) }
  } catch (e: Exception) {
    updateSide(agentId, id) { it.copy(error = HostStore.describe(e)) }
  }
}

/** Send an answered side question into the agent's conversation, queued behind a running turn. */
suspend fun HostStore.sendSideToAgent(agentId: String, id: String) {
  val side = _sideQuestionsByAgent.value[agentId]?.firstOrNull { it.id == id } ?: return
  val answer = side.answer ?: return
  if (side.sent) return
  updateSide(agentId, id) { it.copy(sent = true) }
  sendMessage(agentId, HostStore.sideMessage(side.question, answer))
}

fun HostStore.clearSideQuestions(agentId: String) = _sideQuestionsByAgent.update { it - agentId }

fun HostStore.Companion.sideMessage(question: String, answer: String) =
  "I asked a side question while you were working.\n\nQuestion: $question\n\nAnswer: $answer"

private fun HostStore.updateSide(agentId: String, id: String, change: (SideQuestion) -> SideQuestion) =
  _sideQuestionsByAgent.update { map ->
    val list = map[agentId] ?: return@update map
    map + (agentId to list.map { if (it.id == id) change(it) else it })
  }
