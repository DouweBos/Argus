package dev.houwert.argus.core.stores

import dev.houwert.argus.core.git.CommitMessage
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.protocol.generated.RemoteMentionPathResult
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.SessionWorkflowStatus
import kotlinx.coroutines.flow.update

// Control-scoped session actions: create, rename, delete, land work.

suspend fun HostStore.createSession(
  repoRoot: String,
  branch: String,
  description: String,
  useExistingBranch: Boolean? = null,
  baseBranch: String? = null,
  parentSessionId: String? = null,
  prompt: String? = null,
  model: String? = null,
  permissionMode: RemotePermissionMode? = null,
  runnerId: String? = null,
  linearIssue: String? = null,
  images: List<RemoteImageAttachment>? = null,
  claudeAccountId: String? = null,
): RemoteSession? {
  val backend = backend ?: return null
  return try {
    val session = backend.request(
      Methods.SessionsCreate,
      MethodsTypes.SessionsCreateParams(
        repoRoot = repoRoot, branch = branch, description = description, useExistingBranch = useExistingBranch,
        baseBranch = baseBranch, parentSessionId = parentSessionId, prompt = prompt, model = model,
        permissionMode = permissionMode, runnerId = runnerId, claudeAccountId = claudeAccountId, images = images,
        linearIssue = linearIssue,
      ),
    ).session
    creatingSessions[session.id] = session
    _sessionsByRepo.update { it + (repoRoot to (listOf(session) + it[repoRoot].orEmpty().filterNot { s -> s.id == session.id })) }
    // A setup that fails at once announces it before this reply lands, so re-list to catch it.
    loadSessions(repoRoot)
    session
  } catch (e: Exception) {
    report(e)
    null
  }
}

/** Hand a plan to a fresh session; the computer starts the agent once the worktree is ready. */
suspend fun HostStore.handOffPlan(repoRoot: String, plan: String) {
  val prompt = "Implement the following plan:\n\n$plan"
  createSession(repoRoot, "", prompt, prompt = prompt)
}

// Landing work

/** Stage everything and commit. Git's own output, or null when it refused (already on `lastError`). */
suspend fun HostStore.commit(sessionId: String, message: String, amend: Boolean = false, signOff: Boolean = false, sign: Boolean = false): String? {
  val backend = backend ?: return null
  val action = if (amend) StoreEvent.LandAction.Amend else StoreEvent.LandAction.Commit
  return try {
    // Flags are omitted unless set, so an older computer never sees a key it rejects.
    val output = backend.request(
      Methods.SessionsCommit,
      MethodsTypes.SessionsCommitParams(sessionId, message, amend = amend.orNull(), signOff = signOff.orNull(), sign = sign.orNull()),
    ).output
    hooks.track(StoreEvent.WorkLanded(action, success = true))
    hooks.track(StoreEvent.CommitComposed(CommitMessage.parse(message).hasDescription, signOff, sign))
    loadGitStatus(sessionId)
    output
  } catch (e: Exception) {
    report(e, "session:commit")
    hooks.track(StoreEvent.WorkLanded(action, success = false))
    null
  }
}

private fun Boolean.orNull() = if (this) true else null

/** Claude's message for the staged changes (or every change with [allChanges]). Throws for the composer to show. */
suspend fun HostStore.draftCommitMessage(sessionId: String, allChanges: Boolean = false): CommitMessage? {
  val backend = backend ?: return null
  val draft = backend.request(Methods.SessionsDraftCommitMessage, MethodsTypes.SessionsDraftCommitMessageParams(sessionId, allChanges.orNull()))
  return CommitMessage(draft.subject, draft.body)
}

/** Who a session's commits are authored as, and whether they can be signed. */
data class CommitIdentity(val name: String, val email: String, val canSign: Boolean) {
  /** `Name <email>`, or null when git has neither. */
  val label: String?
    get() = when {
      name.isEmpty() && email.isEmpty() -> null
      email.isEmpty() -> name
      name.isEmpty() -> email
      else -> "$name <$email>"
    }
}

/** Null from an older computer; the composer then just doesn't show who commits. */
suspend fun HostStore.commitIdentity(sessionId: String): CommitIdentity? {
  val backend = backend ?: return null
  return runCatching { backend.request(Methods.SessionsCommitIdentity, MethodsTypes.SessionsCommitIdentityParams(sessionId)) }
    .getOrNull()?.let { CommitIdentity(it.name, it.email, it.canSign) }
}

suspend fun HostStore.push(sessionId: String): MethodsTypes.SessionsPushResult? {
  val backend = backend ?: return null
  return try {
    val result = backend.request(Methods.SessionsPush, MethodsTypes.SessionsPushParams(sessionId))
    hooks.track(StoreEvent.WorkLanded(StoreEvent.LandAction.Push, success = true))
    loadGitStatus(sessionId)
    result
  } catch (e: Exception) {
    report(e, "session:push")
    hooks.track(StoreEvent.WorkLanded(StoreEvent.LandAction.Push, success = false))
    null
  }
}

/** Empty means the merge would go through. */
suspend fun HostStore.mergeBlockers(sessionId: String): List<String> {
  val backend = backend ?: return emptyList()
  return runCatching { backend.request(Methods.SessionsMergeBlockers, MethodsTypes.SessionsMergeBlockersParams(sessionId)).blockers }.getOrDefault(emptyList())
}

/** Files a merge into the base would conflict on; empty when clean and on computers too old to say. */
suspend fun HostStore.mergeConflicts(sessionId: String): List<String> {
  val backend = backend ?: return emptyList()
  return runCatching { backend.request(Methods.SessionsMergeConflicts, MethodsTypes.SessionsMergeConflictsParams(sessionId)).files }.getOrDefault(emptyList())
}

/** Starts an agent that rebases onto the base and resolves the conflicts; its id, to open it. */
suspend fun HostStore.fixConflicts(sessionId: String): String? {
  val backend = backend ?: return null
  return try {
    val result = backend.request(Methods.SessionsFixConflicts, MethodsTypes.SessionsFixConflictsParams(sessionId))
    repoRoot(sessionId)?.let { loadAgents(it) }
    result.agentId
  } catch (e: Exception) {
    report(e, "session:merge")
    null
  }
}

/** What a merge does to the session's commits. Squashing rewrites the agent's history, so the phone asks. */
enum class MergeStrategy(val wire: String, val label: String) {
  Keep("keep", "Keep every commit"),
  Squash("squash", "Squash into one commit"),
}

suspend fun HostStore.mergeIntoBase(sessionId: String, strategy: MergeStrategy): Boolean {
  val backend = backend ?: return false
  return try {
    backend.request(Methods.SessionsMergeBase, MethodsTypes.SessionsMergeBaseParams(sessionId, MethodsTypes.SessionsMergeBaseParamsStrategy(strategy.wire)))
    hooks.track(StoreEvent.WorkLanded(StoreEvent.LandAction.Merge, success = true, strategy = strategy.wire))
    _mergedSessionIds.update { it + sessionId }
    loadGitStatus(sessionId)
    true
  } catch (e: Exception) {
    report(e, "session:merge")
    hooks.track(StoreEvent.WorkLanded(StoreEvent.LandAction.Merge, success = false, strategy = strategy.wire))
    false
  }
}

// Scratch pads

/** Create a scratch pad and start its agent, so there is a chat to land in. */
suspend fun HostStore.createScratchPad(): RemoteAgentStatus? {
  val backend = backend ?: return null
  return try {
    val pad = backend.request(Methods.ScratchPadsCreate, MethodsTypes.ScratchPadsCreateParams()).session
    loadScratchPads()
    spawnAgent(pad.id)
  } catch (e: Exception) {
    report(e)
    null
  }
}

/** A read-only agent in a new scratch pad that diagnoses a problem from the computer's logs. Null fields ask. */
suspend fun HostStore.startTriage(message: String? = null, level: String? = null, source: String? = null): RemoteAgentStatus? {
  val backend = backend ?: return null
  return try {
    val result = backend.request(
      Methods.TriageStart,
      MethodsTypes.TriageStartParams(message?.take(8000), level?.let { MethodsTypes.TriageStartParamsLevel(it) }, source?.take(200)),
    )
    _statusByAgent.update { it + (result.agent.agentId to result.agent) }
    loadScratchPads()
    result.agent
  } catch (e: Exception) {
    report(e)
    null
  }
}

/** The pad's agent to open: its newest live one, else a fresh one when this phone may start agents. */
suspend fun HostStore.scratchPadAgent(pad: RemoteSession): RemoteAgentStatus? {
  val backend = backend ?: return null
  val agents = runCatching { backend.request(Methods.AgentsList, MethodsTypes.AgentsListParams(sessionId = pad.id)).agents }.getOrDefault(emptyList())
  _statusByAgent.update { it + agents.associateBy { a -> a.agentId } }
  agents.filter { it.status != RemoteAgentStatusStatus.stopped }.maxByOrNull { it.createdAt ?: 0.0 }?.let { return it }
  return if (hasControl) spawnAgent(pad.id) else null
}

/** Deleting a pad removes its folder too: there is no branch to keep. */
suspend fun HostStore.deleteScratchPad(id: String) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsDelete, MethodsTypes.SessionsDeleteParams(id))
    loadScratchPads()
  } catch (e: Exception) {
    report(e)
  }
}

/** [deleteBranch] null keeps what a failed delete asked for; [skipTeardown] is "delete anyway". */
suspend fun HostStore.deleteSession(id: String, repoRoot: String, deleteBranch: Boolean? = false, skipTeardown: Boolean = false) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsDelete, MethodsTypes.SessionsDeleteParams(id, deleteBranch, skipTeardown.orNull()))
    _mergedSessionIds.update { it - id }
    loadSessions(repoRoot)
    loadAgents(repoRoot)
  } catch (e: Exception) {
    report(e)
  }
}

suspend fun HostStore.renameSession(id: String, repoRoot: String, name: String) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsRename, MethodsTypes.SessionsRenameParams(id, name))
    hooks.track(StoreEvent.SessionRenamed("session"))
    loadSessions(repoRoot)
  } catch (e: Exception) {
    report(e)
  }
}

/** Point a session at another base; the computer refuses a remote-tracking ref like `origin/main`. */
suspend fun HostStore.setBaseBranch(id: String, baseBranch: String) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsSetBaseBranch, MethodsTypes.SessionsSetBaseBranchParams(id, baseBranch))
    hooks.track(StoreEvent.SessionRenamed("base"))
    repoRoot(id)?.let { loadSessions(it) }
  } catch (e: Exception) {
    report(e, "session:base_branch")
  }
}

suspend fun HostStore.renameSessionBranch(id: String, repoRoot: String, branch: String) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsRenameBranch, MethodsTypes.SessionsRenameBranchParams(id, branch))
    hooks.track(StoreEvent.SessionRenamed("branch"))
    loadSessions(repoRoot)
  } catch (e: Exception) {
    report(e)
  }
}

/** Re-run a failed setup; the computer records the outcome itself. */
suspend fun HostStore.retrySessionSetup(id: String, repoRoot: String) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsRetrySetup, MethodsTypes.SessionsRetrySetupParams(id))
    loadSessions(repoRoot)
  } catch (e: Exception) {
    report(e, "session:retry_setup")
  }
}

/** Unblock a session after its failed setup step was fixed by hand. */
suspend fun HostStore.markSessionReady(id: String, repoRoot: String) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsMarkReady, MethodsTypes.SessionsMarkReadyParams(id))
    loadSessions(repoRoot)
  } catch (e: Exception) {
    report(e, "session:mark_ready")
  }
}

/** Wake the session's agent on its PR's CI results, conflicts and comments, or stop. */
suspend fun HostStore.setPullRequestWatched(sessionId: String, repoRoot: String, watching: Boolean) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsWatchPullRequest, MethodsTypes.SessionsWatchPullRequestParams(sessionId, watching))
    loadSessions(repoRoot)
  } catch (e: Exception) {
    report(e, "session:watch_pull_request")
  }
}

/** Set its workflow status, null following its pull request again. [note] null keeps the note, empty clears it. */
suspend fun HostStore.setSessionStatus(session: RemoteSession, status: SessionWorkflowStatus?, note: String? = null) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsSetStatus, MethodsTypes.SessionsSetStatusParams(session.id, status, note))
    reloadTriaged(session)
  } catch (e: Exception) {
    report(e, "session:set_status")
  }
}

/** Mark as Unread (it waits under Needs you until opened) or Mark as Read. */
suspend fun HostStore.setSessionUnread(session: RemoteSession, unread: Boolean) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsSetUnread, MethodsTypes.SessionsSetUnreadParams(session.id, unread))
    reloadTriaged(session)
  } catch (e: Exception) {
    report(e, "session:set_unread")
  }
}

/** Hide it until [untilMillis], when the computer brings it back with a notification; null unsnoozes. */
suspend fun HostStore.snoozeSession(session: RemoteSession, untilMillis: Long?) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsSnooze, MethodsTypes.SessionsSnoozeParams(session.id, untilMillis?.toDouble()))
    reloadTriaged(session)
  } catch (e: Exception) {
    report(e, "session:snooze")
  }
}

private suspend fun HostStore.reloadTriaged(session: RemoteSession) {
  if (session.kind == RemoteSessionKind.scratchPad) loadScratchPads() else loadSessions(session.repoRoot)
}

// Mentions

suspend fun HostStore.listFiles(sessionId: String): List<String> {
  val backend = backend ?: return emptyList()
  return runCatching { backend.request(Methods.SessionsFiles, MethodsTypes.SessionsFilesParams(sessionId)).files }.getOrDefault(emptyList())
}

suspend fun HostStore.resolveMentionPath(sessionId: String, query: String): RemoteMentionPathResult? {
  val backend = backend ?: return null
  return runCatching { backend.request(Methods.SessionsResolveMentionPath, MethodsTypes.SessionsResolveMentionPathParams(sessionId, query)) }.getOrNull()
}
