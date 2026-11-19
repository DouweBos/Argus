package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.core.stores.MergeStrategy
import dev.houwert.argus.core.stores.StoreEvent
import dev.houwert.argus.core.stores.deleteSession
import dev.houwert.argus.core.stores.fixConflicts
import dev.houwert.argus.core.stores.listBranches
import dev.houwert.argus.core.stores.mergeBlockers
import dev.houwert.argus.core.stores.mergeConflicts
import dev.houwert.argus.core.stores.mergeIntoBase
import dev.houwert.argus.core.stores.push
import dev.houwert.argus.core.stores.setBaseBranch
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranch
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranchScope
import dev.houwert.argus.kit.protocol.isOpen
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ChangeCountsText
import dev.houwert.argus.ui.components.Chip
import dev.houwert.argus.ui.components.ContextCardDivider
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * Commit, push and merge a session's branch, the end of the loop that used to need the computer.
 * Every button needs `control`, and the computer still refuses a protected base or a conflicting
 * merge; this only asks. A conflict offers an agent that rebases and resolves it.
 */
@Composable
fun LandWorkCard(
  sessionId: String,
  allowsAmend: Boolean,
  onChanged: suspend () -> Unit,
  onDeleted: (() -> Unit)? = null,
  onAgentStarted: ((String) -> Unit)? = null,
) {
  val app = LocalAppStore.current
  val host = app.host
  val uri = LocalUriHandler.current
  val scope = rememberCoroutineScope()
  val statuses by host.gitStatusBySession.collectAsState()
  val merged by host.mergedSessionIds.collectAsState()
  host.sessionsByRepo.collectAsState().value
  val status = statuses[sessionId]
  val session = host.session(sessionId)
  val dirty = (status?.dirtyCount ?: 0.0).toInt()
  val baseLabel = session?.baseBranch ?: "the base branch"

  var busy by remember { mutableStateOf<String?>(null) }
  var blockers by remember { mutableStateOf(emptyList<String>()) }
  var note by remember { mutableStateOf<String?>(null) }
  var confirmingMerge by remember { mutableStateOf(false) }
  var confirmingDelete by remember { mutableStateOf(false) }
  var changingBase by remember { mutableStateOf(false) }
  var openingPullRequest by remember { mutableStateOf(false) }
  var conflicts by remember { mutableStateOf(emptyList<String>()) }

  LaunchedEffect(sessionId, dirty) { blockers = host.mergeBlockers(sessionId) }

  suspend fun finish() {
    blockers = host.mergeBlockers(sessionId)
    onChanged()
  }

  Card {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      SectionHeader("Land this work", Modifier.weight(1f))
      Chip("${status?.branch ?: "branch"} → $baseLabel", icon = Icons.branch, contentDescription = "Change the base branch") {
        if (busy == null) changingBase = true
      }
    }
    note?.let { MutedText(it, maxLines = 3) }
    if (dirty > 0) {
      val counts = ChangeCountsText.summary((status?.diffAdditions ?: 0.0).toInt(), (status?.diffDeletions ?: 0.0).toInt())
      val summary = (if (dirty == 1) "1 changed file" else "$dirty changed files") + (counts?.let { " · $it" } ?: "")
      CommitComposer(sessionId, allowsAmend, summary, busy, { busy = it }) { committed ->
        note = committed
        finish()
      }
    } else {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.check, null, Modifier.size(13.dp), tint = ArgusTheme.colors.success)
        MutedText("Working tree clean")
      }
    }
    // The computer would refuse anyway; saying why beats a failed tap.
    for (blocker in blockers) Banner(blocker, tone = Tone.Warning)
    ContextCardDivider()

    val openPr = session?.pullRequest?.takeIf { it.isOpen }
    val ahead = (status?.ahead ?: 0.0).toInt()
    if (session?.pushLocked != true) {
      Btn(
        if (busy == "push") "Pushing" else if (ahead > 0) "Push $ahead commit${if (ahead == 1) "" else "s"}" else "Push",
        tone = ButtonTone.Secondary, small = true, icon = Icons.push, enabled = busy == null, busy = busy == "push",
      ) {
        busy = "push"
        scope.launch {
          val result = host.push(sessionId)
          busy = null
          if (result != null) {
            note = "Pushed ${result.branch} to ${result.remote}."
            finish()
          }
        }
      }
    }
    if (openPr != null) {
      Btn("Pull request #${openPr.number.toInt()}", small = true, icon = Icons.pullRequest) {
        host.hooks.track(StoreEvent.PullRequestActed(StoreEvent.PullRequestAction.View))
        runCatching { uri.openUri(openPr.url) }
      }
    } else {
      Btn("Open pull request", tone = ButtonTone.Secondary, small = true, icon = Icons.pullRequest, enabled = busy == null) {
        openingPullRequest = true
      }
      if (session?.mergeLocked != true) {
        Btn(
          if (busy == "merge") "Merging" else "Merge into ${session?.baseBranch ?: "base"}",
          tone = if (dirty > 0 || blockers.isNotEmpty()) ButtonTone.Secondary else ButtonTone.Primary,
          small = true, icon = Icons.merge, enabled = busy == null && blockers.isEmpty(), busy = busy == "merge",
        ) {
          // A merge that would conflict offers an agent to rebase and resolve it, rather than failing.
          busy = "merge"
          scope.launch {
            val files = host.mergeConflicts(sessionId)
            busy = null
            if (files.isEmpty()) confirmingMerge = true else conflicts = files
          }
        }
      }
    }
    // Merged, the session's work is done: offer to clean it up.
    if (sessionId in merged && onDeleted != null) {
      Btn("Delete session", tone = ButtonTone.Danger, small = true, icon = Icons.trash, enabled = busy == null) { confirmingDelete = true }
    }
  }

  if (confirmingMerge) {
    // Two choices, no default: a squash rewrites the commits the agent wrote.
    ChoiceSheet(
      "Merge into $baseLabel?", "Uncommitted changes are committed first. A conflict stops the merge.",
      MergeStrategy.entries.map { strategy ->
        Choice(strategy.label) {
          busy = "merge"
          scope.launch {
            val ok = host.mergeIntoBase(sessionId, strategy)
            busy = null
            if (ok) {
              note = if (strategy == MergeStrategy.Squash) "Squashed and merged into $baseLabel." else "Merged into $baseLabel."
              finish()
            }
          }
        }
      },
    ) { confirmingMerge = false }
  }
  if (conflicts.isNotEmpty()) {
    val shown = conflicts.take(5).joinToString(", ") { it.substringAfterLast('/') }
    val more = if (conflicts.size > 5) " and ${conflicts.size - 5} more" else ""
    ChoiceSheet(
      "${if (conflicts.size == 1) "1 file conflicts" else "${conflicts.size} files conflict"} with $baseLabel",
      "$shown$more. An agent can rebase onto $baseLabel and resolve them; you merge once it's done.",
      listOf(
        Choice("Rebase with an agent") {
          busy = "merge"
          scope.launch {
            val agentId = host.fixConflicts(sessionId)
            busy = null
            if (agentId != null) {
              note = "An agent is rebasing onto $baseLabel to resolve the conflicts."
              onAgentStarted?.invoke(agentId)
            }
          }
        },
      ),
    ) { conflicts = emptyList() }
  }
  if (confirmingDelete && session != null) {
    ChoiceSheet(
      "Delete this session?",
      "It's merged into $baseLabel. Its worktree is removed from your computer and its agents are shut down.",
      listOf(false, true).map { branch ->
        Choice(if (branch) "Delete session and branch" else "Delete session", destructive = true) {
          busy = "delete"
          scope.launch {
            host.deleteSession(session.id, session.repoRoot, deleteBranch = branch)
            busy = null
            onDeleted?.invoke()
          }
        }
      },
    ) { confirmingDelete = false }
  }
  if (changingBase) {
    BaseBranchSheet(sessionId, session?.baseBranch, onDismiss = { changingBase = false }) { branch ->
      scope.launch {
        host.setBaseBranch(sessionId, branch)
        note = "Base branch is now $branch."
        finish()
      }
    }
  }
  if (openingPullRequest) {
    OpenPullRequestSheet(sessionId, defaultTitle = status?.branch ?: "", onDismiss = { openingPullRequest = false }) { url ->
      note = "Opened $url"
    }
  }
}

/**
 * Pick the branch a merge lands on. Only local branches: the computer can't fast-forward a
 * remote-tracking ref like `origin/main`, the state that used to make a merge fail halfway.
 */
@Composable
private fun BaseBranchSheet(sessionId: String, current: String?, onDismiss: () -> Unit, onPick: (String) -> Unit) {
  val host = LocalAppStore.current.host
  var branches by remember { mutableStateOf<List<RemoteGitBranch>?>(null) }
  LaunchedEffect(sessionId) { branches = host.listBranches(sessionId).filter { it.scope == RemoteGitBranchScope.local } }
  FormSheet("Base branch", null, onDismiss = onDismiss) {
    val list = branches
    when {
      list == null -> Loading("Reading branches")
      list.isEmpty() -> EmptyState(Icons.branch, "No local branches", body = "Check one out on the computer first.")
      else -> ListSection {
        for (branch in list) {
          ListRow(branch.name, chevron = false, onClick = {
            onDismiss()
            onPick(branch.name)
          }, trailing = { if (branch.name == current) Icon(Icons.check, "Current", tint = ArgusTheme.colors.accent) })
        }
      }
    }
    Spacer(Modifier.size(8.dp))
  }
}
