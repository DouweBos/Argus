package dev.houwert.argus.ui.composer

import dev.houwert.argus.core.agents.ModelName
import dev.houwert.argus.kit.protocol.displayName
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.storage.PreferenceKey
import kotlinx.coroutines.launch

// The model, effort, permission-mode, account and linked-project pickers. A start composer keeps
// its picks as a draft for the agent it starts.

/** The account picker's value for "follow the computer's active account". */
const val FOLLOW_DEFAULT_ACCOUNT = ""

val ComposerModel.permissionMode: RemotePermissionMode
  get() {
    starter?.let { return draftMode.value ?: ComposerPermissionMode.canonical(it.defaultMode) }
    return ComposerPermissionMode.canonical(status?.permissionMode)
  }

/**
 * This agent's models; with no agent yet, what the runner last reported, else any agent's on the
 * computer. A custom runner's declared models replace them: its gateway rejects other ids.
 */
val ComposerModel.models: List<RemoteModelInfo>
  get() {
    if (starter != null) {
      val declared = runner.value?.models.orEmpty()
      if (declared.isNotEmpty()) return declared.map { RemoteModelInfo(it.value, it.displayName, it.description.orEmpty()) }
      if (capabilities.models.isEmpty()) {
        val reported = host.lastKnownModels(runner.value?.id)
        if (reported.isNotEmpty()) return reported
      }
    }
    return ComposerOptions.models(capabilities.models, host.capabilitiesByAgent.value)
  }

/** A runner's declared models name no default of their own, so none is presumed. */
private val ComposerModel.declaresModels: Boolean get() = runner.value?.models?.isNotEmpty() == true

/** The model picked for the agent; null is the CLI default. A picked runner starts on its own default. */
val ComposerModel.pickedModel: String?
  get() {
    starter?.let { return draftModel.value ?: if (runner.value == null) it.defaultModel else null }
    return status?.model
  }

val ComposerModel.modelLabel: String
  get() = if (pickedModel == null && declaresModels) "Default" else ModelName.label(pickedModel, models) ?: "Model"

/** A custom runner's models say nothing about effort, so it offers none. */
val ComposerModel.effortLevels: List<String>
  get() = if (!offersImagesAndEffort.value || declaresModels) emptyList()
  else ComposerEffort.levels(ComposerOptions.current(pickedModel, models))

val ComposerModel.effort: String? get() = if (starter != null) draftEffort.value else host.effortByAgent.value[agentId]

val ComposerModel.linkableProjects: List<RemoteProject>
  get() = ComposerOptions.linkable(host.projects.value, sessionId?.let(host::repoRoot))

/** With one account there's nothing to switch between, and only Claude Code runs on one. */
val ComposerModel.offersAccounts: Boolean
  get() {
    if ((host.claudeAccounts.value?.size ?: 0) <= 1) return false
    if (starter != null) return runner.value == null || runner.value?.id == "claude-code"
    return sessionId != null
  }

val ComposerModel.accounts: List<RemoteClaudeAccount> get() = host.claudeAccounts.value.orEmpty()

/** A start's pick, else the session's pinned account, or [FOLLOW_DEFAULT_ACCOUNT]. */
val ComposerModel.accountId: String
  get() {
    if (starter != null) draftAccount.value?.let { return it }
    return sessionId?.let(host::claudeAccountId) ?: FOLLOW_DEFAULT_ACCOUNT
  }

fun ComposerModel.accountName(id: String?): String? = host.claudeAccounts.value?.firstOrNull { it.id == id }?.displayName

val ComposerModel.activeAccountName: String? get() = accountName(host.activeClaudeAccountId.value)

/** The account a live agent's process runs as; null before a start or from older hosts. */
val ComposerModel.runningAccountId: String? get() = if (starter == null) status?.accountId else null

/** Before an agent has talked, following the computer's default is a choice; after, only its account matters. */
val ComposerModel.offersFollowDefault: Boolean get() = !hasConversation

/** A picked account the agent moves to once its turn ends. */
val ComposerModel.hasPendingAccountSwitch: Boolean
  get() {
    val running = runningAccountId ?: return false
    return accountId != FOLLOW_DEFAULT_ACCOUNT && running != accountId
  }

/** The account the agent runs on, or the one it moves to after this turn. */
val ComposerModel.currentAccountId: String?
  get() {
    if (hasPendingAccountSwitch) return accountId
    return runningAccountId ?: if (accountId == FOLLOW_DEFAULT_ACCOUNT) host.activeClaudeAccountId.value else accountId
  }

/** The account picker's ticked row: an agent's account, else the pick or [FOLLOW_DEFAULT_ACCOUNT]. */
val ComposerModel.checkedAccountId: String get() = if (offersFollowDefault) accountId else currentAccountId ?: accountId

fun ComposerModel.accountHint(id: String): String? =
  if (!offersFollowDefault && hasPendingAccountSwitch && id == accountId) "After this turn" else null

/** The account the agent is on, else the one it will start on. */
val ComposerModel.effectiveAccountName: String?
  get() = accountName(runningAccountId) ?: if (accountId == FOLLOW_DEFAULT_ACCOUNT) activeAccountName else accountName(accountId)

fun ComposerModel.setModel(value: String) {
  if (starter != null) {
    draftModel.value = value
    // Effort levels are per model.
    draftEffort.value = null
  } else {
    scope.launch { host.setModel(agentId, value) }
  }
}

/** Model ids don't carry across runners, so a switch drops the model and its effort. */
fun ComposerModel.setRunner(value: RemoteRunner?) {
  if (value?.id == runner.value?.id) return
  _runner.value = value
  draftModel.value = null
  draftEffort.value = null
}

fun ComposerModel.setEffort(level: String?) {
  if (starter != null) draftEffort.value = level else scope.launch { host.setEffort(agentId, level) }
}

fun ComposerModel.setPermissionMode(mode: RemotePermissionMode) {
  if (starter != null) draftMode.value = mode else scope.launch { host.setPermissionMode(agentId, mode) }
}

fun ComposerModel.setAccount(value: String) {
  // A start pins it with the agent, so its first turn already runs there.
  if (starter != null) {
    draftAccount.value = value
    return
  }
  val sessionId = sessionId ?: return
  if (value == checkedAccountId) return
  val account = value.takeIf { it != FOLLOW_DEFAULT_ACCOUNT }
  scope.launch { host.setSessionClaudeAccount(sessionId, account, agentId) }
}

fun ComposerModel.toggleLink(repoRoot: String) {
  val on = repoRoot !in linkedProjects.value
  _linkedProjects.value = linkedProjects.value.filterNot { it == repoRoot } + listOfNotNull(repoRoot.takeIf { on })
  preferences.encode(linkedProjects.value, linkedSerializer, PreferenceKey.linkedProjects(agentId))
}

fun ComposerModel.interrupt() {
  scope.launch { host.interrupt(agentId) }
}
