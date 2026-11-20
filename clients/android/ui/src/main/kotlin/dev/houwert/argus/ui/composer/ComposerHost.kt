package dev.houwert.argus.ui.composer

import dev.houwert.argus.core.stores.ContinueSource
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.SideQuestion
import dev.houwert.argus.core.stores.askSide
import dev.houwert.argus.core.stores.canContinueElsewhere
import dev.houwert.argus.core.stores.clearSideQuestions
import dev.houwert.argus.core.stores.continueOnRunner
import dev.houwert.argus.core.stores.continueRunners
import dev.houwert.argus.core.stores.dismissLimitResume
import dev.houwert.argus.core.stores.handoffAgent
import dev.houwert.argus.core.stores.interrupt
import dev.houwert.argus.core.stores.lastKnownModels
import dev.houwert.argus.core.stores.limitHandoffAccounts
import dev.houwert.argus.core.stores.listFiles
import dev.houwert.argus.core.stores.loadCapabilities
import dev.houwert.argus.core.stores.loadQueue
import dev.houwert.argus.core.stores.loadRunners
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.stores.loadStartOptions
import dev.houwert.argus.core.stores.queueMessage
import dev.houwert.argus.core.stores.resolveMentionPath
import dev.houwert.argus.core.stores.sendMessage
import dev.houwert.argus.core.stores.sendSideToAgent
import dev.houwert.argus.core.stores.setEffort
import dev.houwert.argus.core.stores.setModel
import dev.houwert.argus.core.stores.setPermissionMode
import dev.houwert.argus.core.stores.supportsSideQuestion
import dev.houwert.argus.core.stores.visibleMessages
import dev.houwert.argus.kit.protocol.generated.LimitHandoffAccount
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentCapabilities
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.protocol.generated.RemoteMentionPathResult
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/**
 * The slice of `HostStore` a composer reads and acts on, so `ComposerModel` and the composer's
 * cards can be driven by a fake in tests and the gallery.
 */
interface ComposerHost {
  val statusByAgent: StateFlow<Map<String, RemoteAgentStatus>>
  val capabilitiesByAgent: StateFlow<Map<String, RemoteAgentCapabilities>>
  val startOptionsBySession: StateFlow<Map<String, RemoteAgentCapabilities>>
  val followUpsByAgent: StateFlow<Map<String, List<String>>>
  val effortByAgent: StateFlow<Map<String, String>>
  val claudeAccounts: StateFlow<List<RemoteClaudeAccount>?>
  val activeClaudeAccountId: StateFlow<String?>
  val projects: StateFlow<List<RemoteProject>>
  val runners: StateFlow<List<RemoteRunner>>
  val sessionsByRepo: StateFlow<Map<String, List<RemoteSession>>>
  val sideQuestionsByAgent: StateFlow<Map<String, List<SideQuestion>>>
  /** Everything the getters below read, so a view can recompose when any of it moves. */
  val observed: List<StateFlow<*>>
  val hasControl: Boolean

  fun claudeAccountId(sessionId: String): String?
  fun repoRoot(sessionId: String): String?
  fun visibleMessages(key: String): List<RemoteMessage>
  fun lastKnownModels(runnerId: String?): List<RemoteModelInfo>
  fun supportsSideQuestion(agentId: String): Boolean
  fun continueRunners(agentId: String): List<RemoteRunner>
  fun describe(error: Throwable): String

  suspend fun sendMessage(agentId: String, message: String, images: List<RemoteImageAttachment>, displayText: String?)
  suspend fun queueMessage(agentId: String, message: String, images: List<RemoteImageAttachment>, displayText: String)
  suspend fun interrupt(agentId: String)
  suspend fun dismissLimitResume(agentId: String)
  suspend fun setModel(agentId: String, model: String)
  suspend fun setPermissionMode(agentId: String, mode: RemotePermissionMode)
  suspend fun setEffort(agentId: String, level: String?)
  suspend fun setSessionClaudeAccount(sessionId: String, accountId: String?, agentId: String)

  suspend fun loadCapabilities(agentId: String)
  suspend fun loadQueue(agentId: String)
  suspend fun loadStartOptions(sessionId: String, runnerId: String?)
  suspend fun loadSessions(repoRoot: String)
  suspend fun loadRunners()
  suspend fun refreshClaudeAccounts()
  suspend fun listFiles(sessionId: String): List<String>
  suspend fun resolveMentionPath(sessionId: String, query: String): RemoteMentionPathResult?
  /**
   * Where the session's agent finds an attached file once uploaded; null after reporting why it
   * couldn't be. Past the cap it's refused by `size` alone, so `read` is never called.
   */
  suspend fun hostPath(name: String, size: Long, read: () -> ByteArray?, sessionId: String?): String?

  suspend fun limitHandoffAccounts(agentId: String): List<LimitHandoffAccount>
  /** Throws the host's reason. */
  suspend fun handoffAgent(agentId: String, accountId: String)
  /** Throws the host's reason. */
  suspend fun continueOnRunner(agentId: String, runnerId: String): RemoteAgentStatus
  suspend fun askSide(agentId: String, question: String)
  suspend fun sendSideToAgent(agentId: String, id: String)
  fun clearSideQuestions(agentId: String)

  companion object {
    /** One gateway frame carries the upload: `MAX_BASE64_UPLOAD_BYTES` on the host. */
    const val MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
  }
}

fun HostStore.asComposerHost(): ComposerHost = HostComposerHost(this)

/** `HostStore` as a [ComposerHost]; the few calls no core extension has yet go straight to the backend. */
private class HostComposerHost(private val host: HostStore) : ComposerHost {
  /** Fetched by [refreshClaudeAccounts] until the account store's port owns the list. */
  private val fetchedAccounts = MutableStateFlow<List<RemoteClaudeAccount>?>(null)
  private val fetchedActive = MutableStateFlow<String?>(null)
  private val accountPins = MutableStateFlow(emptyMap<String, String?>())

  override val statusByAgent get() = host.statusByAgent
  override val capabilitiesByAgent get() = host.capabilitiesByAgent
  override val startOptionsBySession get() = host.startOptionsBySession
  override val followUpsByAgent get() = host.followUpsByAgent
  override val effortByAgent get() = host.effortByAgent
  override val claudeAccounts: StateFlow<List<RemoteClaudeAccount>?>
    get() = if (host.claudeAccounts.value != null) host.claudeAccounts else fetchedAccounts.asStateFlow()
  override val activeClaudeAccountId: StateFlow<String?>
    get() = if (host.claudeAccounts.value != null) host.activeClaudeAccountId else fetchedActive.asStateFlow()
  override val projects get() = host.projects
  override val runners get() = host.runners
  override val sessionsByRepo get() = host.sessionsByRepo
  override val sideQuestionsByAgent get() = host.sideQuestionsByAgent
  override val observed: List<StateFlow<*>> = listOf(
    host.statusByAgent, host.capabilitiesByAgent, host.startOptionsBySession, host.followUpsByAgent, host.effortByAgent,
    host.claudeAccounts, host.activeClaudeAccountId, host.projects, host.runners, host.sessionsByRepo,
    host.sideQuestionsByAgent, host.messagesByAgent, host.optimisticByAgent, host.capabilities,
    fetchedAccounts, fetchedActive, accountPins,
  )
  override val hasControl get() = host.hasControl

  override fun claudeAccountId(sessionId: String): String? {
    if (sessionId in accountPins.value) return accountPins.value[sessionId]
    return host.sessionsByRepo.value.values.flatten().firstOrNull { it.id == sessionId }?.claudeAccountId
  }
  override fun repoRoot(sessionId: String) = host.repoRoot(forSessionId = sessionId)
  override fun visibleMessages(key: String) = host.visibleMessages(key)
  override fun lastKnownModels(runnerId: String?) = host.lastKnownModels(runnerId)
  override fun supportsSideQuestion(agentId: String) = host.supportsSideQuestion(agentId)
  override fun continueRunners(agentId: String) = host.continueRunners(agentId)
  override fun describe(error: Throwable) = HostStore.describe(error)

  override suspend fun sendMessage(agentId: String, message: String, images: List<RemoteImageAttachment>, displayText: String?) =
    host.sendMessage(agentId, message, images, displayText)
  override suspend fun queueMessage(agentId: String, message: String, images: List<RemoteImageAttachment>, displayText: String) =
    host.queueMessage(agentId, message, images, displayText)
  override suspend fun interrupt(agentId: String) = host.interrupt(agentId)
  override suspend fun dismissLimitResume(agentId: String) = host.dismissLimitResume(agentId)
  override suspend fun setModel(agentId: String, model: String) = host.setModel(agentId, model)
  override suspend fun setPermissionMode(agentId: String, mode: RemotePermissionMode) = host.setPermissionMode(agentId, mode)
  override suspend fun setEffort(agentId: String, level: String?) = host.setEffort(agentId, level)

  override suspend fun setSessionClaudeAccount(sessionId: String, accountId: String?, agentId: String) {
    val backend = host.backend ?: return
    try {
      // `account_id` encodes an explicit null: nil means "follow the active account".
      backend.request(Methods.AgentsSetClaudeAccount, MethodsTypes.AgentsSetClaudeAccountParams(agentId, accountId))
      // Nothing re-broadcasts the session list on this write.
      accountPins.value = accountPins.value + (sessionId to accountId)
    } catch (error: Exception) {
      host.report(error, "claude_accounts")
    }
  }

  override suspend fun loadCapabilities(agentId: String) = host.loadCapabilities(agentId)
  override suspend fun loadQueue(agentId: String) = host.loadQueue(agentId)
  override suspend fun loadStartOptions(sessionId: String, runnerId: String?) = host.loadStartOptions(sessionId, runnerId)
  override suspend fun loadSessions(repoRoot: String) = host.loadSessions(repoRoot)
  override suspend fun loadRunners() = host.loadRunners()

  override suspend fun refreshClaudeAccounts() {
    val backend = host.backend ?: return
    val result = runCatching { backend.request(Methods.ClaudeAccountsList, MethodsTypes.ClaudeAccountsListParams()) }.getOrNull() ?: return
    fetchedAccounts.value = result.accounts
    fetchedActive.value = result.activeId
  }

  override suspend fun listFiles(sessionId: String) = host.listFiles(sessionId)
  override suspend fun resolveMentionPath(sessionId: String, query: String) = host.resolveMentionPath(sessionId, query)

  override suspend fun hostPath(name: String, size: Long, read: () -> ByteArray?, sessionId: String?): String? {
    val tooBig = "$name is too big to send (${ComposerHost.MAX_ATTACHMENT_BYTES / 1024 / 1024} MB at most)."
    if (size > ComposerHost.MAX_ATTACHMENT_BYTES) return null.also { host.showError(tooBig) }
    val backend = host.backend
    if (sessionId == null || backend == null) return null.also { host.showError("$name couldn't be sent: not connected.") }
    val bytes = withContext(Dispatchers.IO) { read() } ?: return null.also { host.showError("$name couldn't be read.") }
    if (bytes.size > ComposerHost.MAX_ATTACHMENT_BYTES) return null.also { host.showError(tooBig) }
    return try {
      backend.request(
        Methods.SessionsUploadAttachment,
        MethodsTypes.SessionsUploadAttachmentParams(sessionId, name, Base64.getEncoder().encodeToString(bytes)),
      ).relativePath
    } catch (error: Exception) {
      host.showError("$name: ${HostStore.describe(error)}")
      null
    }
  }

  override suspend fun limitHandoffAccounts(agentId: String) = host.limitHandoffAccounts(agentId)
  override suspend fun handoffAgent(agentId: String, accountId: String) = host.handoffAgent(agentId, accountId)
  override suspend fun continueOnRunner(agentId: String, runnerId: String) =
    host.continueOnRunner(agentId, runnerId, ContinueSource.LimitCard)
  override suspend fun askSide(agentId: String, question: String) = host.askSide(agentId, question)
  override suspend fun sendSideToAgent(agentId: String, id: String) = host.sendSideToAgent(agentId, id)
  override fun clearSideQuestions(agentId: String) = host.clearSideQuestions(agentId)
}
