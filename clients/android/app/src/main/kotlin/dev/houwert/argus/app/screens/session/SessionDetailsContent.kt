package dev.houwert.argus.app.screens.session

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.sessions.facts
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.agents
import dev.houwert.argus.core.stores.canTogglePin
import dev.houwert.argus.core.stores.deleteSession
import dev.houwert.argus.core.stores.isPinned
import dev.houwert.argus.core.stores.loadGitStatus
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.stores.loadStoppedAgents
import dev.houwert.argus.core.stores.push
import dev.houwert.argus.core.stores.refreshDevices
import dev.houwert.argus.core.stores.renameSession
import dev.houwert.argus.core.stores.renameSessionBranch
import dev.houwert.argus.core.stores.setPinned
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.SessionPullRequest
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.kit.protocol.isOpen
import dev.houwert.argus.kit.protocol.isOutsideProjects
import dev.houwert.argus.kit.protocol.isUnavailable
import dev.houwert.argus.ui.components.ChangeCounts
import dev.houwert.argus.ui.components.ChangeCountsText
import dev.houwert.argus.ui.components.ConfirmChoice
import dev.houwert.argus.ui.components.ConfirmChoicesDialog
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.PromptDialog
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.icons.Icon as Glyph
import dev.houwert.argus.ui.session.RecentChatRow
import dev.houwert.argus.ui.session.SessionFactRow
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * A session's details and tools, the phone's take on the Mac's context card: its
 * branch and state, then Changes, Files, Terminals, Branches, Devices, MCP,
 * ticket, designs, recent chats, and renaming or deleting it. Shared by the
 * details sheet and the tablet side panel.
 */
@Composable
fun SessionDetailsContent(
  host: HostStore,
  session: RemoteSession,
  agentId: String?,
  open: (Route) -> Unit,
  newAgent: () -> Unit,
  deleted: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val scope = rememberCoroutineScope()
  val uri = LocalUriHandler.current
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val gitBySession by host.gitStatusBySession.collectAsState()
  val stoppedByRepo by host.stoppedByRepo.collectAsState()
  val goneAgents by host.goneAgents.collectAsState()
  val statuses by host.statusByAgent.collectAsState()
  val agentsByRepo by host.agentsByRepo.collectAsState()
  val control = "control" in capabilities
  val git = gitBySession[session.id]
  val activity = remember(session, agentsByRepo, goneAgents) {
    SessionActivity(session, host.agents(session.id, session.repoRoot).filter { it.agentId !in goneAgents })
  }
  val label = activity.title
  val ready = session.status == RemoteSessionStatus.ready && !session.isUnavailable
  val outside = session.isOutsideProjects
  val recentChats = if (outside) emptyList() else (stoppedByRepo[session.repoRoot] ?: emptyList()).filter { it.branch == session.branch }.take(5)

  var renaming by remember { mutableStateOf<RenameKind?>(null) }
  var confirmingDelete by remember { mutableStateOf(false) }
  var pushing by remember { mutableStateOf(false) }
  var createPullRequestUrl by remember { mutableStateOf<String?>(null) }

  LaunchedEffect(session.id) {
    if (session.isUnavailable) return@LaunchedEffect
    host.loadGitStatus(session.id)
    if (!outside) host.loadStoppedAgents(session.repoRoot)
    // Fetched once, not polled: this only decides where the device row goes.
    if (connection == Transport.State.Ready) host.refreshDevices()
  }

  fun openPullRequest(pr: SessionPullRequest) {
    val route = SessionDetailsLinks.pullRequestRoute(pr)
    if (route != null) open(route) else runCatching { uri.openUri(pr.url) }
  }

  LazyColumn(modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
    item("summary") { Summary(session, label, git?.branch) }

    if (ready && !outside) {
      section("git") {
        if (control && session.pushLocked != true) {
          val ahead = git?.ahead?.toInt() ?: 0
          ListRow(
            if (pushing) "Pushing" else "Push",
            icon = Glyph.push,
            value = if (ahead > 0) "↑$ahead" else null,
            tone = if (ahead == 0) Tone.Muted else null,
            chevron = false,
            enabled = !pushing,
            onClick = {
              pushing = true
              scope.launch {
                createPullRequestUrl = host.push(session.id)?.prUrl
                pushing = false
              }
            },
          )
        }
        createPullRequestUrl?.let { url ->
          ListRow("Create pull request", icon = Glyph.pullRequest, onClick = {
            runCatching { uri.openUri(url) }
            createPullRequestUrl = null
          })
        }
        session.pullRequest?.takeIf { it.isOpen }?.let { pr ->
          ListRow(
            "Pull request #${pr.number.toInt()}",
            icon = Glyph.pullRequest,
            value = if (pr.state == SessionPullRequestState.draft) "Draft" else null,
            onClick = { openPullRequest(pr) },
          )
        }
        ChangesRow(git, onClick = { open(Route.Changes(session.id, label)) })
        ListRow("Timeline", icon = Glyph.timeline, onClick = { open(Route.Timeline(session.id, label)) })
      }
    }

    if (ready) {
      section("work") {
        if (outside) {
          ChangesRow(git, onClick = { open(Route.Changes(session.id, label)) })
          ListRow("Timeline", icon = Glyph.timeline, onClick = { open(Route.Timeline(session.id, label)) })
        }
        if (control) {
          ListRow("Open file", icon = Glyph.file, onClick = { open(Route.QuickOpen(session.id, label)) })
          ListRow("Search files", icon = Glyph.search, onClick = { open(Route.FileSearch(session.id, label)) })
        }
        ListRow("Terminals", icon = Glyph.terminal, onClick = { open(Route.Terminals(session.id, label)) })
        // Worktrees are pinned to their branch; the computer only switches branches in the project root.
        if (control && session.kind == RemoteSessionKind.projectRoot) {
          ListRow("Branches", icon = Glyph.branch, onClick = { open(Route.Branches(session.id, session.repoRoot, label)) })
        }
      }
    }

    val designs = session.designRefs.orEmpty()
    if (session.linkedIssue != null || designs.isNotEmpty()) {
      section("references", header = "Ticket and designs") {
        session.linkedIssue?.let { issue ->
          ListRow("${issue.identifier} ${issue.title}", icon = Glyph.issue, onClick = { open(Route.Issue(issue.identifier)) })
        }
        designs.forEach { design ->
          ListRow(design.name, icon = Glyph.design, onClick = { open(Route.Design(design.url, session.id)) })
        }
      }
    }

    section("agent") {
      ListRow("Devices", icon = Glyph.simulator, onClick = { open(Route.Devices) })
      if (control && agentId != null && statuses.let { host.canTogglePin(agentId) }) {
        val pinned = host.isPinned(agentId)
        ListRow(
          if (pinned) "Unpin chat" else "Pin chat",
          icon = if (pinned) Glyph.pinSlash else Glyph.pin,
          chevron = false,
          onClick = { scope.launch { host.setPinned(agentId, !pinned) } },
        )
      }
      if (agentId != null && agentId !in goneAgents) {
        ListRow("MCP servers", icon = Glyph.mcp, onClick = { open(Route.McpServers(agentId)) })
      }
    }

    val canStart = control && ready
    if (canStart || recentChats.isNotEmpty()) {
      section("chats", header = "Agents") {
        if (canStart) ListRow("New agent", icon = Glyph.plus, chevron = false, onClick = newAgent)
        recentChats.forEach { chat ->
          RecentChatRow(chat, onClick = {
            open(Route.StoppedAgent(chat.historyId, session.repoRoot, chat.title, chat.branch, chat.runnerSessionId))
          })
        }
      }
    }

    // Below the tools, so the half-height sheet opens on what you can do.
    val facts = activity.facts(git)
    if (facts.isNotEmpty()) {
      section("facts", header = "Status") { facts.forEach { SessionFactRow(it) } }
    }

    if (control && !session.isUnavailable) {
      section("manage") {
        ListRow("Rename", icon = Glyph.pencil, chevron = false, onClick = { renaming = RenameKind.Name })
        if (session.kind == RemoteSessionKind.worktree) {
          ListRow("Rename branch", icon = Glyph.branch, chevron = false, onClick = { renaming = RenameKind.Branch })
        }
        if (session.kind != RemoteSessionKind.projectRoot) {
          ListRow("Delete session", icon = Glyph.trash, tone = Tone.Danger, chevron = false, onClick = { confirmingDelete = true })
        }
      }
    }
  }

  renaming?.let { kind ->
    PromptDialog(
      title = if (kind == RenameKind.Branch) "Rename branch" else "Rename session",
      initial = if (kind == RenameKind.Branch) session.branch else label,
      placeholder = if (kind == RenameKind.Branch) "new-branch-name" else "Session name",
      message = if (kind == RenameKind.Branch) "Spaces become hyphens." else null,
      input = if (kind == RenameKind.Branch) TextInput.Code else TextInput.Prose,
      onDismiss = { renaming = null },
      onSave = { value ->
        scope.launch {
          when (kind) {
            RenameKind.Name -> host.renameSession(session.id, session.repoRoot, value)
            RenameKind.Branch -> host.renameSessionBranch(session.id, session.repoRoot, value)
          }
          host.loadSessions(session.repoRoot)
        }
      },
    )
  }

  if (confirmingDelete) {
    fun delete(branch: Boolean) {
      scope.launch {
        host.deleteSession(session.id, session.repoRoot, deleteBranch = branch)
        host.loadSessions(session.repoRoot)
        deleted()
      }
    }
    ConfirmChoicesDialog(
      title = "Delete this session?",
      message = "Its worktree is removed from your computer and its agents are shut down.",
      choices = buildList {
        add(ConfirmChoice("Delete session", destructive = true) { delete(false) })
        if (session.kind == RemoteSessionKind.worktree) add(ConfirmChoice("Delete session and branch", destructive = true) { delete(true) })
      },
      onDismiss = { confirmingDelete = false },
    )
  }
}

private enum class RenameKind { Name, Branch }

object SessionDetailsLinks {
  /** In the app when the link names a GitHub pull request, else null for the browser. */
  fun pullRequestRoute(pr: SessionPullRequest): Route.PullRequest? {
    val path = runCatching { java.net.URI(pr.url).path }.getOrNull() ?: return null
    val parts = path.split("/").filter { it.isNotEmpty() }
    if (parts.size < 4 || parts[2] != "pull") return null
    val number = pr.number.toInt()
    return Route.PullRequest("${parts[0]}/${parts[1]}", number, "#$number")
  }
}

private fun LazyListScope.section(key: String, header: String? = null, content: @Composable () -> Unit) {
  item(key) { ListSection(header = header, content = content) }
}

@Composable
private fun Summary(session: RemoteSession, label: String, branch: String?) {
  val theme = ArgusTheme.colors
  Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Text(label, style = ArgusTheme.typography.headline, color = theme.text)
    if (!session.isOutsideProjects) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(Glyph.branch, null, Modifier.size(14.dp), tint = theme.textSecondary)
        Text(
          branch ?: session.branch,
          style = argusFont(13, mono = true),
          color = theme.textSecondary,
          maxLines = 1,
          overflow = TextOverflow.MiddleEllipsis,
        )
      }
    }
    if (session.isUnavailable) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(Glyph.drive, null, Modifier.size(14.dp), tint = theme.textSecondary)
        Text(
          "${session.unavailableVolume ?: "The drive"} isn't connected to your computer",
          style = ArgusTheme.typography.footnote,
          color = theme.textSecondary,
        )
      }
    }
  }
}

@Composable
private fun ChangesRow(git: RemoteGitStatus?, onClick: () -> Unit) {
  val additions = git?.diffAdditions?.toInt()
  val deletions = git?.diffDeletions?.toInt()
  val dirty = git?.dirtyCount?.toInt() ?: 0
  ListRow(
    "Changes",
    icon = Glyph.changes,
    value = if ((additions == null || deletions == null || !ChangeCountsText.hasChanges(additions, deletions)) && dirty > 0) "$dirty" else null,
    onClick = onClick,
    trailing = if (additions != null && deletions != null && ChangeCountsText.hasChanges(additions, deletions)) {
      { ChangeCounts(additions, deletions) }
    } else null,
  )
}
