package dev.houwert.argus.kit.protocol

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranch
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranchScope
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionAvailability
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionProgress
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent
import dev.houwert.argus.kit.protocol.generated.SessionPullRequest
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState

// The computed members of ArgusKit's hand-written `Protocol/Models.swift`, on the generated types.

val RemoteSession.isUnavailable: Boolean get() = availability == RemoteSessionAvailability.unavailable

/** A scratch pad or automation run: its own folder, no project, no git. */
val RemoteSession.isOutsideProjects: Boolean
  get() = kind == RemoteSessionKind.scratchPad || kind == RemoteSessionKind.automationHost

val SessionPullRequest.isOpen: Boolean get() = state == SessionPullRequestState.open || state == SessionPullRequestState.draft

val RemoteSessionProgress.isTeardown: Boolean get() = phase?.rawValue == "teardown"

/** 0..1, or null when there is nothing to measure against. */
val RemoteSessionProgress.fraction: Double? get() = if (total > 0) (current / total).coerceIn(0.0, 1.0) else null

val RemoteAgentStatus.id: String get() = agentId
val RemoteAgentStatus.isPinned: Boolean get() = pinned == true

/** Idle with its process let go; the next message resumes it. */
val RemoteAgentStatus.isPaused: Boolean get() = paused == true

val RemoteStoppedAgent.id: String get() = historyId
val RemoteStoppedAgent.isImported: Boolean get() = importedFrom != null
val RemoteStoppedAgent.isPinned: Boolean get() = pinned == true

val RemoteImageAttachment.dataUri: String get() = "data:$mediaType;base64,$data"

val RemotePermissionMode.label: String
  get() = when (this) {
    RemotePermissionMode.auto -> "Auto"
    RemotePermissionMode.ask -> "Ask"
    RemotePermissionMode.plan -> "Plan"
    RemotePermissionMode.review -> "Review"
    else -> rawValue.replaceFirstChar { it.uppercase() }
  }

val RemoteGitBranch.id: String get() = "${scope.rawValue}:$name"

/** The ref git resolves: `origin/x` for a branch that only exists remotely. */
val RemoteGitBranch.ref: String get() = if (scope == RemoteGitBranchScope.remote) "${remote ?: "origin"}/$name" else name

/** What the account list shows as its primary line. */
val RemoteClaudeAccount.displayName: String get() = label ?: email ?: id

/** "Max · Acme": the plan and org, whichever are known. */
val RemoteClaudeAccount.subtitle: String
  get() = listOfNotNull(subscriptionType, orgName).map { it.trim() }.filter { it.isNotEmpty() }.joinToString(" · ")
