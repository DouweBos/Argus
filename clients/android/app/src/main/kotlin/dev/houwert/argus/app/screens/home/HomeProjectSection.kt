package dev.houwert.argus.app.screens.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.sessions.SessionGroup
import dev.houwert.argus.core.sessions.SessionGroupTriage
import dev.houwert.argus.core.sessions.SessionListRow
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.isUnavailable
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.ProjectBadge
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.sessions.FoldedSessionsLabel
import dev.houwert.argus.ui.sessions.ProjectRootState
import dev.houwert.argus.ui.sessions.SidebarSectionHeader
import dev.houwert.argus.ui.sessions.SessionTriageSheet
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** What Home's project card needs from the screen around it. */
class HomeProjectActions(
  val push: (Route) -> Unit,
  val newSession: (RemoteProject) -> Unit,
  val present: (SessionTriageSheet) -> Unit,
  val remove: (RemoteProject) -> Unit,
)

/**
 * One project on Home, as the Mac sidebar draws it: a header that folds the card shut, then its
 * sessions, those that need you first, the done and snoozed ones folded.
 */
fun LazyListScope.homeProjectSection(
  host: HostStore,
  project: RemoteProject,
  sessions: List<RemoteSession>,
  groups: List<SessionGroup>,
  allSessions: List<RemoteSession>,
  gitStatus: Map<String, RemoteGitStatus>,
  collapsedSet: Set<String>,
  unfoldedSet: Set<String>,
  hasControl: Boolean,
  actions: HomeProjectActions,
) {
  val key = project.repoRoot
  val hasWorktrees = sessions.any { it.kind != RemoteSessionKind.projectRoot }
  val collapsed = hasWorktrees && key in collapsedSet
  val unfolded = key in unfoldedSet
  val root = groups.firstOrNull { it.isRoot }
  // The root lives in the header until sessions beside it and an agent in it want a row of its own.
  val rootRow = hasWorktrees && (root?.agents?.isNotEmpty() == true)
  val triage = SessionGroupTriage(groups.filter { !it.isRoot || rootRow })

  item("project:$key") {
    ProjectHeader(host, project, sessions, if (rootRow) null else root, triage, hasWorktrees, collapsed, gitStatus, hasControl, actions)
  }
  if (collapsed) return
  fun rows(prefix: String, list: List<SessionGroup>, faded: Boolean = false) {
    val rows = SessionListRow.make(list, allSessions)
    items(rows, key = { "$prefix:$key:${it.key}" }) { row ->
      Box(Modifier.alpha(if (faded) 0.7f else 1f)) {
        SessionListRowView(
          host, row,
          open = { s -> actions.push(Route.Session(s.group.id, s.group.label, key)) },
          openCompare = { actions.push(Route.CompareRun(it)) },
          present = actions.present,
        )
      }
    }
  }
  if (triage.needsYou.isNotEmpty()) {
    item("needs:$key") { SidebarSectionHeader("Needs you", Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
    rows("n", triage.needsYou)
    // Without a rule of their own the rest read as more of what needs you.
    if (triage.active.isNotEmpty()) item("sessions:$key") { SidebarSectionHeader("Sessions", Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
  }
  rows("a", triage.active)
  if (triage.folded.isNotEmpty()) {
    item("fold:$key") {
      HomeRow(triage.foldedLabel, onClick = { ProjectFolds.toggle(ProjectFolds.unfolded, key) }) {
        FoldedSessionsLabel(triage.foldedLabel, unfolded)
      }
    }
    if (unfolded) {
      rows("d", triage.done, faded = true)
      rows("z", triage.snoozed)
    }
  }
}

@Composable
private fun ProjectHeader(
  host: HostStore,
  project: RemoteProject,
  sessions: List<RemoteSession>,
  root: SessionGroup?,
  triage: SessionGroupTriage,
  hasWorktrees: Boolean,
  collapsed: Boolean,
  gitStatus: Map<String, RemoteGitStatus>,
  hasControl: Boolean,
  actions: HomeProjectActions,
) {
  val theme = ArgusTheme.colors
  val rootSession = sessions.firstOrNull { it.kind == RemoteSessionKind.projectRoot && !it.isUnavailable }
  fun open(session: RemoteSession) = actions.push(Route.Session(session.id, session.branch, project.repoRoot))
  fun toggle() = ProjectFolds.toggle(ProjectFolds.collapsed, project.repoRoot)
  Column {
    HorizontalDivider(color = theme.borderSubtle)
    Row(Modifier.fillMaxWidth().padding(end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
      if (hasWorktrees) {
        IconBtn(if (collapsed) Icon.chevronRight else Icon.chevronDown, if (collapsed) "Expand ${project.name}" else "Collapse ${project.name}", size = 14.dp, tint = theme.textMuted) { toggle() }
      } else {
        Box(Modifier.size(16.dp))
      }
      Box(Modifier.weight(1f)) {
        PressableRow(
          project.name, Modifier.padding(vertical = 10.dp),
          onClick = { if (rootSession != null) open(rootSession) else if (hasWorktrees) toggle() },
          menu = { dismiss ->
            if (hasControl) DropdownMenuItem({ Text("New session") }, { dismiss(); actions.newSession(project) }, leadingIcon = { Icon(Icon.plus, null) })
            val anyRoot = sessions.firstOrNull { it.kind == RemoteSessionKind.projectRoot }
            if (anyRoot != null && !anyRoot.isUnavailable) DropdownMenuItem({ Text("Open ${anyRoot.branch}") }, { dismiss(); open(anyRoot) }, leadingIcon = { Icon(Icon.branch, null) })
            DropdownMenuItem({ Text("Sessions and Chats") }, { dismiss(); actions.push(Route.Project(project.repoRoot, project.name)) }, leadingIcon = { Icon(Icon.history, null) })
            if (hasWorktrees) DropdownMenuItem({ Text(if (collapsed) "Expand" else "Collapse") }, { dismiss(); toggle() }, leadingIcon = { Icon(if (collapsed) Icon.chevronDown else Icon.chevronRight, null) })
            if (hasControl) {
              HorizontalDivider()
              DropdownMenuItem({ Text("Remove Project", color = theme.error) }, { dismiss(); actions.remove(project) }, leadingIcon = { Icon(Icon.trash, null, tint = theme.error) })
            }
          },
        ) {
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            ProjectBadge(project.name, key = project.repoRoot, size = 22.dp)
            Column(Modifier.weight(1f)) {
              Text(project.name, color = theme.text, style = argusFont(17, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
              if (collapsed) summary(triage, sessions)?.let { (text, urgent) ->
                Text(text, color = if (urgent) theme.warning else theme.textMuted, style = ArgusTheme.typography.caption, maxLines = 1)
              }
            }
            root?.session?.let { session ->
              ProjectRootState(SessionActivity(session, root.agents), gitStatus[session.id]?.branch ?: session.branch)
            }
          }
        }
      }
      if (hasControl) IconBtn(Icon.plus, "New session in ${project.name}", tint = theme.accent) { actions.newSession(project) }
    }
  }
}

/** What a folded card still owes you: what needs you, else what's running, else how many. */
private fun summary(triage: SessionGroupTriage, sessions: List<RemoteSession>): Pair<String, Boolean>? {
  val needs = triage.needsYou.size
  if (needs > 0) return "$needs need${if (needs == 1) "s" else ""} you" to true
  val working = triage.active.count { g -> g.session?.let { SessionActivity(it, g.agents).isBusy } == true }
  if (working > 0) return "$working working" to false
  val count = sessions.count { it.kind == RemoteSessionKind.worktree }
  return if (count == 0) null else "$count session${if (count == 1) "" else "s"}" to false
}
