package dev.houwert.argus.ui.gallery

import dev.houwert.argus.core.stores.SideQuestion
import dev.houwert.argus.kit.protocol.generated.LimitHandoffAccount
import dev.houwert.argus.kit.protocol.generated.RemoteAgentCapabilities
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccountAccountType
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.protocol.generated.RemoteMentionEntry
import dev.houwert.argus.kit.protocol.generated.RemoteMentionPathResult
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSlashCommand
import dev.houwert.argus.kit.protocol.generated.RemoteTokenUsage
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindow
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindowKind
import dev.houwert.argus.ui.composer.ComposerHost
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** A composer host with realistic fixtures and no computer behind it; sends land nowhere. */
internal class GalleryComposerHost(
  state: RemoteAgentStatusStatus = RemoteAgentStatusStatus.idle,
  permissionMode: String = "auto",
  stalled: Boolean = false,
  talked: Boolean = true,
  followUps: List<String> = emptyList(),
  private val handoffAccounts: List<LimitHandoffAccount> = emptyList(),
  sideQuestions: List<SideQuestion> = emptyList(),
) : ComposerHost {
  override val statusByAgent = MutableStateFlow(
    mapOf(
      AGENT to RemoteAgentStatus(
        agentId = AGENT, sessionId = SESSION, status = state, model = "claude-opus-5-5", permissionMode = permissionMode,
        limitStalled = stalled, accountId = "work",
      ),
    ),
  )
  override val capabilitiesByAgent = MutableStateFlow(mapOf(AGENT to capabilities))
  override val startOptionsBySession = MutableStateFlow(mapOf(SESSION to capabilities))
  override val followUpsByAgent = MutableStateFlow(mapOf(AGENT to followUps))
  override val effortByAgent = MutableStateFlow(mapOf(AGENT to "high"))
  override val claudeAccounts = MutableStateFlow<List<RemoteClaudeAccount>?>(
    listOf(account("work", "Work", "Max · Acme"), account("personal", "Personal", "Pro")),
  )
  override val activeClaudeAccountId = MutableStateFlow<String?>("work")
  override val projects = MutableStateFlow(
    listOf("argus", "website", "design-tokens", "billing-service", "ios-sdk", "docs").map { RemoteProject("/Users/me/Work/$it", it) },
  )
  override val runners = MutableStateFlow(
    listOf(RemoteRunner("codex", "Codex", isCustom = false, models = emptyList())),
  )
  override val sessionsByRepo = MutableStateFlow(emptyMap<String, List<RemoteSession>>())
  override val sideQuestionsByAgent = MutableStateFlow(mapOf(AGENT to sideQuestions))
  private val messages = MutableStateFlow(if (talked) mapOf(AGENT to transcript) else emptyMap())
  override val observed: List<StateFlow<*>> = listOf(statusByAgent, messages, sideQuestionsByAgent)
  override val hasControl = true

  override fun claudeAccountId(sessionId: String): String? = null
  override fun repoRoot(sessionId: String) = "/Users/me/Work/argus"
  override fun visibleMessages(key: String) = messages.value[key].orEmpty()
  override fun lastKnownModels(runnerId: String?) = capabilities.models
  override fun supportsSideQuestion(agentId: String) = true
  override fun continueRunners(agentId: String) = runners.value
  override fun describe(error: Throwable) = error.message ?: "Failed"

  override suspend fun sendMessage(agentId: String, message: String, images: List<RemoteImageAttachment>, displayText: String?) = Unit
  override suspend fun queueMessage(agentId: String, message: String, images: List<RemoteImageAttachment>, displayText: String) = Unit
  override suspend fun interrupt(agentId: String) = Unit
  override suspend fun dismissLimitResume(agentId: String) = Unit
  override suspend fun setModel(agentId: String, model: String) = update { it.copy(model = model) }
  override suspend fun setPermissionMode(agentId: String, mode: RemotePermissionMode) = update { it.copy(permissionMode = mode.rawValue) }
  override suspend fun setEffort(agentId: String, level: String?) {
    effortByAgent.value = if (level == null) emptyMap() else mapOf(AGENT to level)
  }
  override suspend fun setSessionClaudeAccount(sessionId: String, accountId: String?, agentId: String) = Unit
  override suspend fun loadCapabilities(agentId: String) = Unit
  override suspend fun loadQueue(agentId: String) = Unit
  override suspend fun loadStartOptions(sessionId: String, runnerId: String?) = Unit
  override suspend fun loadSessions(repoRoot: String) = Unit
  override suspend fun loadRunners() = Unit
  override suspend fun refreshClaudeAccounts() = Unit
  override suspend fun listFiles(sessionId: String) = files
  override suspend fun resolveMentionPath(sessionId: String, query: String) =
    RemoteMentionPathResult(listOf(RemoteMentionEntry("components", true), RemoteMentionEntry("App.tsx", false)), query)
  override suspend fun hostPath(name: String, size: Long, read: () -> ByteArray?, sessionId: String?) = ".argus/attachments/$name"
  override suspend fun limitHandoffAccounts(agentId: String) = handoffAccounts
  override suspend fun handoffAgent(agentId: String, accountId: String) = Unit
  override suspend fun continueOnRunner(agentId: String, runnerId: String) = statusByAgent.value.getValue(AGENT)
  override suspend fun askSide(agentId: String, question: String) = Unit
  override suspend fun sendSideToAgent(agentId: String, id: String) = Unit
  override fun clearSideQuestions(agentId: String) {
    sideQuestionsByAgent.value = emptyMap()
  }

  private fun update(change: (RemoteAgentStatus) -> RemoteAgentStatus) {
    statusByAgent.value = statusByAgent.value.mapValues { change(it.value) }
  }

  companion object {
    const val AGENT = "gallery-agent"
    const val SESSION = "gallery-session"

    private val capabilities = RemoteAgentCapabilities(
      models = listOf(
        RemoteModelInfo("default", "Default (recommended)", "Opus 5.5 for complex work", supportsEffort = true,
          supportedEffortLevels = listOf("low", "medium", "high", "xhigh", "max"), resolvedModel = "claude-opus-5-5"),
        RemoteModelInfo("claude-opus-5-5", "Opus", "Most capable", supportsEffort = true,
          supportedEffortLevels = listOf("low", "medium", "high", "xhigh", "max")),
        RemoteModelInfo("claude-sonnet-5-5", "Sonnet", "Fast and capable", supportsEffort = true,
          supportedEffortLevels = listOf("low", "medium", "high")),
        RemoteModelInfo("claude-haiku-5-5", "Haiku", "Fastest"),
      ),
      commands = listOf(
        RemoteSlashCommand("review", "Review a pull request", "<pr>"),
        RemoteSlashCommand("security-review", "Review pending changes for security issues", ""),
        RemoteSlashCommand("init", "Write a CLAUDE.md for this codebase", ""),
      ),
      agents = emptyList(),
    )

    val files = listOf(
      "clients/android/app/build.gradle.kts", "clients/android/ui/src/main/kotlin/App.kt", "packages/host/src/app.ts",
      "packages/host/src/boot.ts", "clients/argus-web/src/App.tsx", "clients/argus-web/src/main.tsx", "README.md",
    )

    private val transcript = listOf(
      RemoteMessage("m1", RemoteMessageRole("user"), listOf("Port the composer"), emptyList()),
      RemoteMessage(
        "m2", RemoteMessageRole.assistant, listOf("Done."), emptyList(),
        usage = RemoteTokenUsage(inputTokens = 12_000.0, outputTokens = 3_000.0, cacheReadInputTokens = 168_000.0),
      ),
    )

    private fun account(id: String, label: String, plan: String) = RemoteClaudeAccount(
      id, label = label, subscriptionType = plan, needsReauth = false, rateLimited = false,
      accountType = RemoteClaudeAccountAccountType.claudeai,
    )

    fun handoff(nowMillis: Long) = listOf(
      LimitHandoffAccount(
        "personal", "Personal", "me@example.com",
        UsageLimitWindow("weekly", UsageLimitWindowKind("weekly"), "Weekly", 42.4, resetsAt = nowMillis + 2 * 3_600_000.0),
      ),
      LimitHandoffAccount("team", "Team", null, null),
    )
  }
}
