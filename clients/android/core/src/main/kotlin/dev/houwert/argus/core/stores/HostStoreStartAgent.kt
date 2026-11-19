package dev.houwert.argus.core.stores

import dev.houwert.argus.core.sessions.AgentStartDefaults
import dev.houwert.argus.core.git.BaseBranchPicker
import dev.houwert.argus.core.sessions.ComposerStart
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Starting an agent with its first message, in a session or a new worktree, as the phone's start composer does.

private fun permissionMode(raw: String?): RemotePermissionMode? =
  raw?.let { mode -> RemotePermissionMode.entries.firstOrNull { it.rawValue == mode } }

/** Spawns an agent in a session and returns its id, or null when it didn't start (the store reports why). */
suspend fun HostStore.startAgent(sessionId: String, mode: String?, model: String?, runnerId: String? = null, accountId: String? = null): String? =
  spawnAgent(sessionId, model = model, permissionMode = permissionMode(mode), runnerId = runnerId, claudeAccountId = accountId)?.agentId

/**
 * An agent in the session with the request as its first turn. [onSpawned] runs once it exists,
 * before the message lands: where a caller navigates.
 */
suspend fun HostStore.startAgent(
  inSession: String,
  request: ComposerStart,
  defaults: AgentStartDefaults,
  onSpawned: ((agentId: String, sessionId: String) -> Unit)? = null,
): String? {
  val agentId = startAgent(
    inSession, request.permissionMode?.rawValue ?: defaults.mode, request.model(defaults), request.runnerId, request.accountId,
  ) ?: return null
  request.effort(defaults)?.let { setEffort(agentId, it) }
  val hasMessage = request.message.isNotEmpty() || request.images.isNotEmpty()
  val send = if (hasMessage) scope.async { sendMessage(agentId, request.message, request.images, null) } else null
  onSpawned?.invoke(agentId, inSession)
  send?.await()
  return agentId
}

/**
 * A new worktree off [baseBranch], or on [existingBranch], with the request's agent. Text alone
 * rides the session's own prompt, which the host starts once setup finishes; images and effort
 * can't, so this starts that agent itself.
 */
suspend fun HostStore.startInNewWorktree(
  repoRoot: String,
  baseBranch: String?,
  existingBranch: String? = null,
  request: ComposerStart,
  defaults: AgentStartDefaults,
  hostWaits: Boolean = false,
  onSpawned: ((agentId: String, sessionId: String) -> Unit)? = null,
): RemoteSession? {
  val effort = request.effort(defaults)
  // The caller goes away at once (a share), so the computer starts it, effort aside.
  val hostStarts = hostWaits || (request.images.isEmpty() && effort == null)
  val session = createSession(
    repoRoot = repoRoot, branch = existingBranch ?: "", description = request.displayText,
    useExistingBranch = if (existingBranch != null) true else null,
    baseBranch = if (existingBranch == null) baseBranch else null,
    prompt = if (hostStarts && request.message.isNotEmpty()) request.message else null,
    model = request.model(defaults), permissionMode = request.permissionMode ?: permissionMode(defaults.mode),
    runnerId = request.runnerId,
    images = if (hostStarts && request.images.isNotEmpty()) request.images else null,
    claudeAccountId = request.accountId?.ifEmpty { null },
  ) ?: return null
  if (!hostStarts) scope.launch { startWhenReady(session.id, request, defaults, onSpawned) }
  return session
}

/** Waits out a new worktree's setup, then starts its agent. */
suspend fun HostStore.startWhenReady(
  id: String,
  request: ComposerStart,
  defaults: AgentStartDefaults,
  onSpawned: ((agentId: String, sessionId: String) -> Unit)? = null,
): String? {
  val deadline = System.currentTimeMillis() + 30 * 60_000
  while (System.currentTimeMillis() < deadline) {
    when (session(id)?.status) {
      RemoteSessionStatus.ready -> return startAgent(id, request, defaults, onSpawned)
      RemoteSessionStatus.error, RemoteSessionStatus.deleting -> return null
      else -> delay(1_000)
    }
  }
  return null
}

/** Read with the project root's branch as the tiebreak, as the desktop does. */
suspend fun BaseBranchPicker.load(repoRoot: String, store: HostStore) =
  load(repoRoot, store.sessionsByRepo.value[repoRoot]?.firstOrNull { it.kind == RemoteSessionKind.projectRoot }?.branch, store)
