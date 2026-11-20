package dev.houwert.argus.app.screens.start

import dev.houwert.argus.core.git.BaseBranchPicker
import dev.houwert.argus.core.sessions.AgentStartDefaults
import dev.houwert.argus.core.sessions.ComposerStart
import dev.houwert.argus.core.sessions.StartWorkspace
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.startAgent
import dev.houwert.argus.core.stores.startInNewWorktree
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranch
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What a start produced, for the caller to navigate to. */
sealed interface StartedAgent {
  data class Agent(val agent: RemoteAgentStatus) : StartedAgent
  data class Session(val session: RemoteSession) : StartedAgent
}

/**
 * A phone start composer's choices beyond the text: where the agent works, on which branch, with
 * which runner, and the start they make.
 */
class PhoneAgentStart(
  private val host: HostStore,
  repoRoot: String?,
  val sessionId: String?,
  workspace: StartWorkspace.Kind,
  private val defaults: AgentStartDefaults,
  /** The caller asked for a project chip, and no session pins the start to one. */
  val picksProject: Boolean,
  private val hostWaits: Boolean = false,
) {
  private val _repoRoot = MutableStateFlow(repoRoot)
  /** Pickable while there's no session to pin it. */
  val repoRoot: StateFlow<String?> = _repoRoot.asStateFlow()
  val openedOnRepo = repoRoot

  // With no session there's no "current"; with no project, nothing else.
  private val _kind = MutableStateFlow(if (sessionId == null) StartWorkspace.Kind.Worktree else if (repoRoot == null) StartWorkspace.Kind.Current else workspace)
  val kind: StateFlow<StartWorkspace.Kind> = _kind.asStateFlow()
  private val _bases = MutableStateFlow(BaseBranchPicker())
  val bases: StateFlow<BaseBranchPicker> = _bases.asStateFlow()
  val existingBranch = MutableStateFlow<String?>(null)
  val branches = MutableStateFlow(emptyList<RemoteGitBranch>())
  /** Null is the computer's default runner. */
  val runnerId = MutableStateFlow<String?>(null)

  fun pick(kind: StartWorkspace.Kind) { _kind.value = kind }

  fun pickProject(root: String) {
    if (!picksProject || root == _repoRoot.value) return
    _repoRoot.value = root
    _bases.value = BaseBranchPicker()
    existingBranch.value = null
    branches.value = emptyList()
  }

  val options: List<StartWorkspace.Kind>
    get() = (if (sessionId != null) listOf(StartWorkspace.Kind.Current) else emptyList()) +
      (if (_repoRoot.value != null) listOf(StartWorkspace.Kind.Worktree, StartWorkspace.Kind.Existing) else emptyList())

  /** A new worktree's base, and, with no session to list branches from, an existing branch's choices. */
  val needsBases: Boolean
    get() = _repoRoot.value != null &&
      (_kind.value == StartWorkspace.Kind.Worktree || (_kind.value == StartWorkspace.Kind.Existing && branches.value.isEmpty()))

  /** Whether the composer may send: something to say where it goes, and somewhere to go. */
  fun ready(text: String): Boolean = picksReady && (_kind.value != StartWorkspace.Kind.Worktree || text.isNotBlank())

  /** Every choice the footer makes is in; the text is the composer's to check. */
  val picksReady: Boolean
    get() = when (_kind.value) {
      StartWorkspace.Kind.Current -> sessionId != null
      StartWorkspace.Kind.Worktree -> _repoRoot.value != null
      StartWorkspace.Kind.Existing -> _repoRoot.value != null && existingBranch.value != null
    }

  suspend fun start(request: ComposerStart): StartedAgent? {
    val repoRoot = _repoRoot.value
    return when (_kind.value) {
      StartWorkspace.Kind.Current -> {
        val sessionId = sessionId ?: return null
        val agentId = host.startAgent(sessionId, request, defaults) ?: return null
        host.statusByAgent.value[agentId]?.let { StartedAgent.Agent(it) }
      }
      StartWorkspace.Kind.Worktree, StartWorkspace.Kind.Existing -> {
        repoRoot ?: return null
        val existing = if (_kind.value == StartWorkspace.Kind.Existing) existingBranch.value else null
        host.startInNewWorktree(repoRoot, _bases.value.base, existing, request, defaults, hostWaits)?.let { StartedAgent.Session(it) }
      }
    }
  }
}
