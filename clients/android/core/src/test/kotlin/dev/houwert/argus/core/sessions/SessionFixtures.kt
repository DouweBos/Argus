package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusAwaiting
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionAvailability
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.SessionCompareGroup
import dev.houwert.argus.kit.protocol.generated.SessionPullRequest
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.kit.protocol.generated.SessionWorkflowStatus

// The minimal wire shapes the Swift tests decode from JSON, built directly.

fun session(
  id: String,
  kind: RemoteSessionKind = RemoteSessionKind.worktree,
  status: RemoteSessionStatus = RemoteSessionStatus.ready,
  branch: String = "b-$id",
  name: String? = null,
  base: String? = null,
  parent: String? = null,
  compare: Pair<String, Long>? = null,
  setupError: String? = null,
  unavailable: Boolean = false,
  pullRequest: SessionPullRequestState? = null,
  pullRequestWatched: Boolean? = null,
  settled: Boolean? = null,
  workflowStatus: SessionWorkflowStatus? = null,
  statusNote: String? = null,
  snoozedUntil: Double? = null,
  unread: Boolean? = null,
  lastMessageAt: Double? = null,
): RemoteSession = RemoteSession(
  id = id,
  repoRoot = "/r",
  kind = kind,
  branch = branch,
  displayName = name,
  baseBranch = base,
  parentSessionId = parent,
  status = status,
  setupError = setupError,
  availability = if (unavailable) RemoteSessionAvailability.unavailable else null,
  pullRequest = pullRequest?.let { SessionPullRequest(1.0, it, "u") },
  pullRequestWatched = pullRequestWatched,
  settled = settled,
  workflowStatus = workflowStatus,
  statusNote = statusNote,
  snoozedUntil = snoozedUntil,
  unread = unread,
  lastMessageAt = lastMessageAt,
  compareGroup = compare?.let { SessionCompareGroup(it.first, it.second) },
)

fun agent(
  id: String,
  session: String = "s1",
  status: RemoteAgentStatusStatus = RemoteAgentStatusStatus.idle,
  created: Double? = 0.0,
  active: Double? = null,
  awaiting: RemoteAgentStatusAwaiting? = null,
  projectName: String? = null,
): RemoteAgentStatus = RemoteAgentStatus(
  agentId = id,
  sessionId = session,
  status = status,
  createdAt = created,
  lastActivityAt = active,
  awaiting = awaiting,
  projectName = projectName,
)

fun git(
  upstream: String? = "origin/fix-login",
  ahead: Int = 0,
  behind: Int = 0,
  additions: Int? = null,
  deletions: Int? = null,
  dirty: Int = 0,
  conflicts: Int = 0,
): RemoteGitStatus = RemoteGitStatus(
  branch = "fix-login",
  upstream = upstream,
  ahead = ahead.toDouble(),
  behind = behind.toDouble(),
  dirtyCount = dirty.toDouble(),
  stashCount = 0.0,
  conflictCount = conflicts.toDouble(),
  detached = false,
  diffAdditions = additions?.toDouble(),
  diffDeletions = deletions?.toDouble(),
)
