package dev.houwert.argus.ui.composer

import dev.houwert.argus.core.stores.SideQuestion
import dev.houwert.argus.kit.protocol.generated.LimitHandoffAccount
import dev.houwert.argus.kit.protocol.generated.RemoteAgentCapabilities
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.protocol.generated.RemoteMentionEntry
import dev.houwert.argus.kit.protocol.generated.RemoteMentionPathResult
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class FakeComposerHost : ComposerHost {
  data class Sent(val message: String, val displayText: String?, val images: List<RemoteImageAttachment>)

  override val statusByAgent = MutableStateFlow(emptyMap<String, RemoteAgentStatus>())
  override val capabilitiesByAgent = MutableStateFlow(emptyMap<String, RemoteAgentCapabilities>())
  override val startOptionsBySession = MutableStateFlow(emptyMap<String, RemoteAgentCapabilities>())
  override val followUpsByAgent = MutableStateFlow(emptyMap<String, List<String>>())
  override val effortByAgent = MutableStateFlow(emptyMap<String, String>())
  override val claudeAccounts = MutableStateFlow<List<RemoteClaudeAccount>?>(emptyList())
  override val activeClaudeAccountId = MutableStateFlow<String?>(null)
  override val projects = MutableStateFlow(emptyList<RemoteProject>())
  override val runners = MutableStateFlow(emptyList<RemoteRunner>())
  override val sessionsByRepo = MutableStateFlow(emptyMap<String, List<RemoteSession>>())
  override val sideQuestionsByAgent = MutableStateFlow(emptyMap<String, List<SideQuestion>>())
  val messagesByAgent = MutableStateFlow(emptyMap<String, List<RemoteMessage>>())
  override val observed: List<StateFlow<*>> = listOf(statusByAgent, messagesByAgent)
  override var hasControl = true

  var files = emptyList<String>()
  var mentionEntries = emptyMap<String, List<String>>()
  var mentionDelay: (String) -> Long = { 0 }
  val sent = mutableListOf<Sent>()
  val queued = mutableListOf<Sent>()
  val modes = mutableListOf<RemotePermissionMode>()
  val models = mutableListOf<String>()
  val loadedCapabilities = mutableListOf<String>()
  val pins = mutableMapOf<String, String?>()
  val interrupted = mutableListOf<String>()
  var failingAttachments = emptySet<String>()
  var attachmentGate: CompletableDeferred<Unit>? = null
  var pending = emptyList<RemoteToolCall>()
  val decisions = mutableListOf<Pair<String, String>>()

  fun status(agentId: String, state: RemoteAgentStatusStatus, accountId: String? = null) {
    statusByAgent.value += agentId to RemoteAgentStatus(agentId = agentId, sessionId = "s1", status = state, accountId = accountId)
  }

  override fun claudeAccountId(sessionId: String) = pins[sessionId]
  override fun repoRoot(sessionId: String): String? = null
  override fun visibleMessages(key: String) = messagesByAgent.value[key].orEmpty()
  override fun pendingCalls(agentKey: String, messages: List<RemoteMessage>) = pending
  override fun lastKnownModels(runnerId: String?) = emptyList<RemoteModelInfo>()
  override fun supportsSideQuestion(agentId: String) = true
  override fun continueRunners(agentId: String) = runners.value
  override fun describe(error: Throwable) = error.message ?: "failed"

  override suspend fun sendMessage(agentId: String, message: String, images: List<RemoteImageAttachment>, displayText: String?) {
    sent += Sent(message, displayText, images)
  }
  override suspend fun queueMessage(agentId: String, message: String, images: List<RemoteImageAttachment>, displayText: String) {
    queued += Sent(message, displayText, images)
  }
  override suspend fun interrupt(agentId: String) { interrupted += agentId }
  override suspend fun respond(agentId: String, toolUseId: String, decision: String) { decisions += toolUseId to decision }
  override suspend fun dismissLimitResume(agentId: String) = Unit
  override suspend fun setModel(agentId: String, model: String) { models += model }
  override suspend fun setPermissionMode(agentId: String, mode: RemotePermissionMode) { modes += mode }
  override suspend fun setEffort(agentId: String, level: String?) = Unit
  override suspend fun setSessionClaudeAccount(sessionId: String, accountId: String?, agentId: String) { pins[sessionId] = accountId }
  override suspend fun loadCapabilities(agentId: String) { loadedCapabilities += agentId }
  override suspend fun loadQueue(agentId: String) = Unit
  override suspend fun loadStartOptions(sessionId: String, runnerId: String?) = Unit
  override suspend fun loadSessions(repoRoot: String) = Unit
  override suspend fun loadRunners() = Unit
  override suspend fun refreshClaudeAccounts() = Unit
  override suspend fun listFiles(sessionId: String) = files

  override suspend fun resolveMentionPath(sessionId: String, query: String): RemoteMentionPathResult {
    val wait = mentionDelay(query)
    if (wait > 0) delay(wait)
    return RemoteMentionPathResult(mentionEntries[query].orEmpty().map { RemoteMentionEntry(it, false) }, query)
  }

  override suspend fun hostPath(name: String, size: Long, read: () -> ByteArray?, sessionId: String?): String? {
    attachmentGate?.await()
    return if (name in failingAttachments) null else ".argus/attachments/x/$name"
  }

  override suspend fun limitHandoffAccounts(agentId: String) = emptyList<LimitHandoffAccount>()
  override suspend fun handoffAgent(agentId: String, accountId: String) = Unit
  override suspend fun continueOnRunner(agentId: String, runnerId: String): RemoteAgentStatus =
    RemoteAgentStatus(agentId = "new", sessionId = "s1", status = RemoteAgentStatusStatus.idle)
  override suspend fun askSide(agentId: String, question: String) = Unit
  override suspend fun sendSideToAgent(agentId: String, id: String) = Unit
  override fun clearSideQuestions(agentId: String) = Unit
}
