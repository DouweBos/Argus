package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.stores.branchLog
import dev.houwert.argus.core.stores.listBranches
import dev.houwert.argus.kit.protocol.generated.RemoteCommit
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranch
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranchScope
import dev.houwert.argus.kit.protocol.id
import dev.houwert.argus.kit.protocol.ref
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ChromeSearchField
import dev.houwert.argus.ui.components.Chip
import dev.houwert.argus.ui.components.CommitRow
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * A project root's branches, as the Mac's branch list: tap to open one, long-press for its
 * menu, `+` for a new branch. Session worktrees are pinned to their branch, so the computer
 * only accepts branch operations on a project root.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun BranchesScreen(sessionId: String, repoRoot: String, label: String) {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val control = hasControl()
  val actions = remember(sessionId) { BranchActions(sessionId, repoRoot, host, scope) }
  val menu = rememberBranchMenu(actions)
  var branches by remember { mutableStateOf(emptyList<RemoteGitBranch>()) }
  var loaded by remember { mutableStateOf(false) }
  var refreshing by remember { mutableStateOf(false) }
  var filter by rememberSaveable { mutableStateOf("") }

  suspend fun refresh() {
    val listed = host.listBranches(sessionId)
    branches = listed
    actions.branches = listed
    actions.current = listed.firstOrNull { it.isCurrent }?.name
    loaded = true
  }
  actions.onChanged = { refresh() }
  LaunchedEffect(sessionId) { refresh() }

  val needle = filter.trim().lowercase()
  val filtered = if (needle.isEmpty()) branches else branches.filter { needle in it.name.lowercase() }
  val compare = { branch: RemoteGitBranch ->
    actions.current?.let { router.push(Route.BranchCompare(sessionId, it, branch.ref)) }
    Unit
  }

  GitScaffold(
    "Branches · $label",
    if (control) listOf(BarAction("New branch", Icons.plus, enabled = !actions.busy) { actions.newBranch() }) else emptyList(),
  ) {
    Column(Modifier.fillMaxSize().background(ArgusTheme.colors.bg)) {
      ChromeSearchField(filter, { filter = it }, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), placeholder = "Filter branches")
      PullToRefreshBox(refreshing, onRefresh = {
        refreshing = true
        scope.launch {
          refresh()
          refreshing = false
        }
      }, Modifier.weight(1f)) {
        when {
          !loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Loading("Reading branches") }
          filtered.isEmpty() -> EmptyState(
            Icons.branch, "No branches",
            body = if (branches.isEmpty()) "This repository has no branches yet." else "Nothing matches that filter.",
          )
          else -> LazyColumn(Modifier.fillMaxSize().alpha(if (actions.busy) 0.6f else 1f)) {
            for ((title, scopeFilter) in listOf("Local" to RemoteGitBranchScope.local, "Remote only" to RemoteGitBranchScope.remote)) {
              val items = filtered.filter { it.scope == scopeFilter }
              if (items.isEmpty()) continue
              item(key = "h:$title") { SectionHeader("$title · ${items.size}", Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
              items(items, key = { it.id }) { branch ->
                BranchRow(
                  branch,
                  onOpen = { router.push(Route.Branch(sessionId, repoRoot, branch)) },
                  menu = if (control) menu(branch) { compare(branch) }.all else null,
                )
              }
            }
          }
        }
      }
    }
  }
  BranchActionPrompts(actions)
}

/** A branch in the list: its name and marks, the last commit, ahead and behind; long-press for its menu. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BranchRow(branch: RemoteGitBranch, onOpen: () -> Unit, menu: List<BranchMenuEntry>?) {
  val theme = ArgusTheme.colors
  var open by remember { mutableStateOf(false) }
  Box {
    Row(
      Modifier.fillMaxWidth()
        .semantics { if (menu != null) onLongClick("Branch actions") { open = true; true } }
        .combinedClickable(onClickLabel = "Open ${branch.name}", onLongClick = menu?.let { { open = true } }, onClick = onOpen)
        .padding(horizontal = 16.dp, vertical = 10.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          BodyText(branch.name, Modifier.weight(1f, fill = false), maxLines = 1)
          if (branch.pinned == true) Icon(Icons.pin, "Pinned", Modifier.size(12.dp), tint = theme.textMuted)
          if (branch.isCurrent) Badge("current", tone = Tone.Accent)
          if (branch.scope == RemoteGitBranchScope.remote) Badge(branch.remote ?: "remote")
        }
        branch.lastCommitSubject?.let { MutedText(it, maxLines = 1) }
      }
      if (branch.ahead > 0) MutedText("↑${branch.ahead}")
      if (branch.behind > 0) MutedText("↓${branch.behind}")
      Icon(Icons.chevronRight, null, Modifier.size(12.dp), tint = theme.textMuted)
    }
    if (menu != null) {
      DropdownMenu(open, { open = false }, containerColor = theme.surface) { BranchMenuItems(menu) { open = false } }
    }
  }
}

/**
 * One branch: where it stands, what you can do with it, and its history. Without control
 * this is a read-only view of the branch and its commits.
 */
@Composable
fun BranchScreen(sessionId: String, repoRoot: String, initial: RemoteGitBranch) {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val control = hasControl()
  val actions = remember(sessionId) { BranchActions(sessionId, repoRoot, host, scope) }
  val menu = rememberBranchMenu(actions)
  var branch by remember { mutableStateOf(initial) }
  var commits by remember { mutableStateOf<List<RemoteCommit>?>(null) }

  suspend fun reload() {
    val branches = host.listBranches(sessionId)
    branches.firstOrNull { it.id == branch.id }?.let { branch = it }
    actions.current = branches.firstOrNull { it.isCurrent }?.name
    actions.branches = branches
    commits = host.branchLog(sessionId, branch.ref) ?: commits ?: emptyList()
  }
  actions.onChanged = { reload() }
  actions.onRenamed = { _, name -> branch = branch.copy(name = name) }
  actions.onDeleted = { router.pop() }
  LaunchedEffect(sessionId, initial.id) { reload() }

  GitScaffold(branch.name) {
    Screen {
      Card {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          MonoText(branch.name, Modifier.weight(1f), size = 14, color = theme.text, maxLines = 2)
          if (branch.pinned == true) Badge("pinned")
          if (branch.isCurrent) Badge("current", tone = Tone.Accent)
          if (branch.scope == RemoteGitBranchScope.remote) Badge(branch.remote ?: "remote")
        }
        val upstream = branch.upstream
        if (upstream != null) MutedText("Tracks $upstream") else if (branch.scope == RemoteGitBranchScope.local) MutedText("Not published")
        if (branch.ahead > 0 || branch.behind > 0) MutedText("${branch.ahead} ahead · ${branch.behind} behind its upstream")
      }
      if (control) BranchActionBar(branch, actions, menu(branch, null))
      val current = actions.current
      if (current != null && current != branch.name) {
        Card(onClick = { router.push(Route.BranchCompare(sessionId, current, branch.ref)) }) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            BodyText("Compare with $current", Modifier.weight(1f))
            Icon(Icons.chevronRight, null, Modifier.size(12.dp), tint = theme.textMuted)
          }
        }
      }
      SectionHeader("History", count = commits?.size)
      val list = commits
      when {
        list == null -> Loading("Reading history")
        list.isEmpty() -> MutedText("No commits.")
        else -> for (commit in list) {
          CommitRow(commit.subject, commit.shortHash, commit.author, isoMillis(commit.date)?.let(Labels::timeAgo)) {
            router.push(Route.Commit(sessionId, commit.hash, commit.subject))
          }
        }
      }
      Spacer(Modifier.size(ArgusMetrics.space))
    }
  }
  BranchActionPrompts(actions)
}

/** The branch screen's actions: the obvious next step as a button, the rest grouped in menus. */
@Composable
private fun BranchActionBar(branch: RemoteGitBranch, actions: BranchActions, sections: BranchMenuSections) {
  val isLocal = branch.scope == RemoteGitBranchScope.local
  FlowRow(Modifier.alpha(if (actions.busy) 0.5f else 1f), packed = true) {
    if (!branch.isCurrent) {
      Btn(if (isLocal) "Switch to" else "Check out locally", small = true, icon = Icons.branch, hugs = true, enabled = !actions.busy) {
        actions.checkout(branch)
      }
      MenuGroup("Merge", Icons.merge, sections.integrate, actions.busy)
    }
    if (isLocal || branch.upstream != null) {
      MenuGroup(if (isLocal && branch.upstream == null) "Publish" else "Remote", Icons.push, sections.remote, actions.busy)
    }
    MenuGroup("More", Icons.ellipsis, sections.newBranch + listOf(BranchMenuEntry.Divider) + sections.manage, actions.busy)
  }
}

@Composable
private fun MenuGroup(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, entries: List<BranchMenuEntry>, busy: Boolean) {
  var open by remember { mutableStateOf(false) }
  Box {
    Chip(label, icon = icon, contentDescription = label) { if (!busy) open = true }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) { BranchMenuItems(entries) { open = false } }
  }
}
