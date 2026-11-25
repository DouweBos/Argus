package dev.houwert.argus.core.stores

import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.kit.protocol.generated.Commands
import dev.houwert.argus.kit.protocol.generated.CommandsTypes
import dev.houwert.argus.kit.protocol.generated.IntegrationId
import dev.houwert.argus.kit.protocol.generated.IntegrationStatus
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetail
import dev.houwert.argus.kit.protocol.generated.LinearIssueScope
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import java.util.Collections
import java.util.WeakHashMap
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

// Linear and Figma as the computer has them connected. A key typed on the phone goes to the computer's
// secret store and never comes back; browser sign-in needs the computer's own loopback, so it stays there.

// Held beside the store rather than in it; every Issues or Design screen reloads it on open.
private val integrationsByStore = Collections.synchronizedMap(WeakHashMap<HostStore, MutableStateFlow<List<IntegrationStatus>>>())

private val HostStore.integrationsFlow: MutableStateFlow<List<IntegrationStatus>>
  get() = integrationsByStore.getOrPut(this) { MutableStateFlow(emptyList()) }

val HostStore.integrations: StateFlow<List<IntegrationStatus>> get() = integrationsFlow

/** Linear is connected and its key still works. */
val HostStore.linearConnected: Boolean get() = integrations.value.isConnected(IntegrationId.linear)

fun List<IntegrationStatus>.isConnected(id: IntegrationId): Boolean = any { it.id == id && it.connected && !it.needsReauth }

suspend fun HostStore.loadIntegrations() {
  val backend = backend ?: return
  integrationsFlow.value =
    try {
      backend.request(Methods.IntegrationsList, MethodsTypes.IntegrationsListParams()).integrations
    } catch (e: Exception) {
      if (HostStore.isCancellation(e)) throw e
      // An older computer has no integrations to offer.
      emptyList()
    }
}

/** No query: the connected user's open issues in `scope`. Throws the computer's own sentence. */
suspend fun HostStore.linearIssues(query: String, scope: LinearIssueScope? = null, limit: Int? = null): List<LinearIssue> {
  val backend = backend ?: return emptyList()
  val term = query.trim()
  return backend.request(
    Methods.LinearIssues,
    MethodsTypes.LinearIssuesParams(query = term.ifEmpty { null }, scope = if (term.isEmpty()) scope else null, limit = limit?.toLong()),
  ).issues
}

/** The whole issue plus its team's workflow; a null issue when Linear has none. */
suspend fun HostStore.linearIssue(ref: String): Pair<LinearIssueDetail?, List<LinearWorkflowState>> {
  val backend = backend ?: return null to emptyList()
  val result = backend.request(Methods.LinearIssue, MethodsTypes.LinearIssueParams(ref))
  return result.issue to result.states
}

/** A team's whole workflow. Admin-tier, so only a computer's own window gets one; empty over the gateway. */
suspend fun HostStore.linearTeamStates(teamId: String): List<LinearWorkflowState> {
  val backend = backend ?: return emptyList()
  if (backend.kind != HostBackendKind.Local) return emptyList()
  return backend.request(Commands.LinearTeamStates, CommandsTypes.LinearTeamStatesParams(teamId))
}

/** Moves an issue to another state or priority, as the connected user. */
suspend fun HostStore.updateLinearIssue(id: String, stateId: String? = null, priority: Int? = null): LinearIssue? {
  val backend = backend ?: return null
  return backend.request(
    Methods.LinearUpdateIssue,
    MethodsTypes.LinearUpdateIssueParams(issueId = id, stateId = stateId, priority = priority?.toLong()),
  ).issue
}

/** `parentId` replies in that comment's thread. */
suspend fun HostStore.commentOnLinearIssue(id: String, body: String, parentId: String? = null) {
  val backend = backend ?: return
  backend.request(Methods.LinearComment, MethodsTypes.LinearCommentParams(issueId = id, body = body, parentId = parentId))
}

/** Linear uploads come back as files on the computer, so only its own window can show them inline. */
val HostStore.showsLinearMedia: Boolean get() = backend?.kind == HostBackendKind.Local

/** The session already working on the issue, across every loaded project. */
fun HostStore.session(workingOn: LinearIssue): RemoteSession? =
  LinearIssueBoard.session(workingOn, sessionsByRepo.value.values.flatten())

/**
 * One worktree session per issue, on Linear's branch name, each with an agent the computer starts
 * on the issue once setup finishes.
 */
suspend fun HostStore.startFromIssues(
  issues: List<LinearIssue>,
  repoRoot: String,
  baseBranch: String? = null,
  prompt: String = "",
  model: String? = null,
  permissionMode: RemotePermissionMode? = null,
  runnerId: String? = null,
): List<RemoteSession> = issues.mapNotNull { issue ->
  createSession(
    repoRoot = repoRoot, branch = issue.branchName, description = issue.identifier, baseBranch = baseBranch,
    prompt = prompt.ifEmpty { null }, model = model, permissionMode = permissionMode, runnerId = runnerId,
    linearIssue = issue.identifier,
  )
}

/** Sends a key typed on the phone to the computer's secret store; it never comes back. Throws the computer's sentence. */
suspend fun HostStore.connectIntegration(id: IntegrationId, key: String) {
  val backend = backend ?: return
  apply(backend.request(Methods.IntegrationsConnectKey, MethodsTypes.IntegrationsConnectKeyParams(id, key.trim())).integration)
}

suspend fun HostStore.disconnectIntegration(id: IntegrationId) {
  val backend = backend ?: return
  apply(backend.request(Methods.IntegrationsDisconnect, MethodsTypes.IntegrationsDisconnectParams(id)).integration)
}

private fun HostStore.apply(status: IntegrationStatus) {
  val current = integrationsFlow.value
  integrationsFlow.value = if (current.any { it.id == status.id }) current.map { if (it.id == status.id) status else it } else current + status
}

/** The integrations a phone can connect, one screen each. */
enum class IntegrationKind(val wire: String, val title: String) {
  Linear("linear", "Linear"), Figma("figma", "Figma"), Slack("slack", "Slack");

  /** Linear and Figma take a key; Slack takes its own app's two tokens. */
  val keyIntegration: IntegrationId? get() = when (this) {
    Linear -> IntegrationId.linear
    Figma -> IntegrationId.figma
    Slack -> null
  }

  /** Where to create the key, as the Mac's Settings → Integrations says it. */
  val keyHelp: String get() = when (this) {
    Linear -> "Create a personal API key in Linear under Settings → Account → Security & access."
    Figma -> "Create a personal access token in Figma under Settings → Security."
    Slack -> "Create the app from the manifest, install it, then paste its two tokens."
  }

  companion object {
    fun of(wire: String): IntegrationKind? = entries.firstOrNull { it.wire == wire }
  }
}
