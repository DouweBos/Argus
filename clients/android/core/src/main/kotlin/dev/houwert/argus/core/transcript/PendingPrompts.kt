package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallChild
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.util.PendingForm

/**
 * The decisions an agent is waiting on, and how each one is headed. The Swift version reads
 * `HostStore`; here the store passes in the state it holds (prompt and answered keys, agent state).
 */
object PendingPrompts {
  /** How the store keys a prompt: `agentId:toolUseId`. */
  fun promptKey(agentKey: String, toolUseId: String): String = "$agentKey:$toolUseId"

  /** Top-level calls still awaiting a decision. Decisions sit at the tail, so only the last [window] messages are walked. */
  fun calls(messages: List<RemoteMessage>, window: Int = 40, isPending: (RemoteToolCall) -> Boolean): List<RemoteToolCall> =
    messages.takeLast(window).flatMap { message -> message.toolCalls.filter(isPending) }

  /**
   * A call is pending until it's answered here, expires, or its agent stops; a forwarded prompt
   * makes it pending whatever the transcript says. [promptKeys] and [answered] hold [promptKey]s.
   */
  fun isToolCallPending(
    agentKey: String,
    call: RemoteToolCall,
    promptKeys: Set<String>,
    answered: Set<String>,
    agentState: RemoteAgentStatusStatus?,
  ): Boolean {
    val key = promptKey(agentKey, call.id)
    if (key in answered) return false
    if (call.expired == true) return false
    // A stopped agent's last call can't be answered any more.
    if (agentState == RemoteAgentStatusStatus.stopped || agentState == RemoteAgentStatusStatus.error) return false
    if (key in promptKeys) return true
    return call.status == RemoteToolCallStatus.pending || call.pendingPermission == true
  }

  /** The call or anything a sub-agent ran under it is waiting on a decision. */
  fun hasPendingCall(call: RemoteToolCall, isPending: (RemoteToolCall) -> Boolean): Boolean =
    isPending(call) || call.children.orEmpty().any {
      it is RemoteToolCallChild.ToolUse && hasPendingCall(it.value.toolCall, isPending)
    }

  /** Top-level calls in [messages] the agent is waiting on (`HostStore.pendingCalls` in Swift). */
  fun pendingCalls(
    agentKey: String,
    messages: List<RemoteMessage>,
    promptKeys: Set<String>,
    answered: Set<String>,
    agentState: RemoteAgentStatusStatus?,
  ): List<RemoteToolCall> =
    calls(messages) { isToolCallPending(agentKey, it, promptKeys, answered, agentState) }

  fun title(call: RemoteToolCall): String = when (PendingForm.of(call.name, call.input)) {
    is PendingForm.Question -> "Question from the agent"
    is PendingForm.Plan -> "Plan ready for review"
    is PendingForm.Secret -> "The agent needs a secret"
    PendingForm.Buttons -> "Permission needed"
  }
}
