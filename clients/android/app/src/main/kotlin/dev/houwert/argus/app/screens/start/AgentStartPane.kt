package dev.houwert.argus.app.screens.start

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.automations.isAvailable
import dev.houwert.argus.core.automations.pickerHint
import dev.houwert.argus.core.stores.load
import dev.houwert.argus.core.sessions.AgentStartDefaults
import dev.houwert.argus.core.sessions.ComposerStart
import dev.houwert.argus.core.sessions.StartWorkspace
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.listBranches
import dev.houwert.argus.core.stores.loadRunners
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranchScope
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.PickerSheet
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

private enum class Picker { Base, Existing, Runner, Project, Workspace }

/**
 * The start composer as a screen's content: an empty project or session shows it in place, a new
 * session pushes it. The strip under the field picks where the agent works and what it starts on.
 * For a new worktree the computer names the branch from the prompt.
 */
@Composable
fun AgentStartPane(
  host: HostStore,
  repoRoot: String?,
  sessionId: String?,
  modifier: Modifier = Modifier,
  workspace: StartWorkspace.Kind = StartWorkspace.Kind.Current,
  defaults: AgentStartDefaults = AgentStartDefaults(),
  picksProject: Boolean = false,
  hostWaits: Boolean = false,
  onStarted: (StartedAgent) -> Unit,
) {
  val theme = ArgusTheme.colors
  val flow = remember(repoRoot, sessionId) { PhoneAgentStart(host, repoRoot, sessionId, workspace, defaults, picksProject && sessionId == null, hostWaits) }
  val root by flow.repoRoot.collectAsState()
  val kind by flow.kind.collectAsState()
  val bases by flow.bases.collectAsState()
  val base by bases.picked.collectAsState()
  val preselected by bases.preselected.collectAsState()
  val baseOptions by bases.options.collectAsState()
  val loadingBases by bases.loading.collectAsState()
  val existing by flow.existingBranch.collectAsState()
  val branches by flow.branches.collectAsState()
  val runnerId by flow.runnerId.collectAsState()
  val runners by host.runners.collectAsState()
  val projects by host.projects.collectAsState()
  val sessions by host.sessionsByRepo.collectAsState()
  var text by remember { mutableStateOf("") }
  var sending by remember { mutableStateOf(false) }
  var picker by remember { mutableStateOf<Picker?>(null) }
  val scope = rememberCoroutineScope()
  val project = projects.firstOrNull { it.repoRoot == root }
  val session = sessionId?.let { id -> sessions.values.flatten().firstOrNull { it.id == id } }

  LaunchedEffect(Unit) {
    host.loadRunners()
    if (sessionId != null && root != null) flow.branches.value = host.listBranches(sessionId)
  }
  // Only a new worktree needs a base, read again for another project.
  LaunchedEffect(flow.needsBases, root, bases) { root?.let { if (flow.needsBases) bases.load(it, host) } }

  fun send() {
    val message = text.trim()
    if (sending || !flow.ready(message)) return
    sending = true
    scope.launch {
      val started = flow.start(ComposerStart(message, message, runnerId = runnerId))
      sending = false
      if (started != null) {
        text = ""
        onStarted(started)
      }
    }
  }

  Column(
    modifier.fillMaxSize().background(theme.bg).imePadding().padding(horizontal = 16.dp),
    verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    // Heading: "What should we build in <project>?"
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
      val heading = argusFont(22, FontWeight.Medium)
      if (project != null) {
        Text("What should we build in", color = theme.text, style = heading, textAlign = TextAlign.Center)
        val pickable = flow.picksProject && projects.size > 1
        Text(
          "${project.name}?",
          if (pickable) Modifier.argusClickable(rememberInteraction(), label = "Project: ${project.name}") { picker = Picker.Project } else Modifier,
          color = theme.text, style = heading.copy(textDecoration = if (pickable) TextDecoration.Underline else null),
          maxLines = 1, overflow = TextOverflow.MiddleEllipsis,
        )
      } else {
        Text("What should we work on?", color = theme.text, style = heading)
        if (flow.picksProject) {
          Text("Pick a project", Modifier.argusClickable(rememberInteraction(), label = "Pick a project") { picker = Picker.Project }, color = theme.accent, style = ArgusTheme.typography.subheadline)
        } else if (session != null) {
          Text(host.placeName(session), color = theme.textSecondary, style = ArgusTheme.typography.footnote)
        }
      }
      if (kind == StartWorkspace.Kind.Worktree) {
        Text("The computer names the branch from what you write.", color = theme.textSecondary, style = ArgusTheme.typography.footnote, textAlign = TextAlign.Center)
      }
    }

    // The composer card with its footer strip.
    Column(Modifier.widthIn(max = 640.dp).fillMaxWidth()) {
      val shape = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)
      Row(
        Modifier.fillMaxWidth().background(theme.bgSecondary, shape).border(1.dp, theme.border, shape).padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.Bottom,
      ) {
        Box(Modifier.weight(1f).padding(vertical = 8.dp)) {
          if (text.isEmpty()) Text("What should it do?", color = theme.textMuted, style = ArgusTheme.typography.body)
          BasicTextField(
            text, { text = it }, Modifier.fillMaxWidth().semantics { contentDescription = "Message" },
            textStyle = ArgusTheme.typography.body.copy(color = theme.text), cursorBrush = SolidColor(theme.accent), maxLines = 8,
          )
        }
        val canSend = flow.ready(text) && !sending
        Box(
          Modifier.size(40.dp).argusClickable(rememberInteraction(), enabled = canSend, shape = RoundedCornerShape(50), label = "Start agent") { send() }
            .semantics { contentDescription = "Start agent" },
          contentAlignment = Alignment.Center,
        ) {
          Box(Modifier.size(32.dp).background(if (canSend) theme.accent else theme.border, RoundedCornerShape(50)), contentAlignment = Alignment.Center) {
            Icon(Icon.send, null, Modifier.size(16.dp), tint = if (canSend) theme.onAccent else theme.textMuted)
          }
        }
      }
      val footShape = RoundedCornerShape(bottomStart = 14.dp, bottomEnd = 14.dp)
      Row(
        Modifier.fillMaxWidth().background(theme.bgSecondary, footShape).border(1.dp, theme.border, footShape)
          .horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically,
      ) {
        if (flow.options.size > 1) FooterPill(kindIcon(kind), kindLabel(kind, session?.kind), "Workspace: ${kindLabel(kind, session?.kind)}") { picker = Picker.Workspace }
        // Only the icon until a runner is picked.
        if (runners.isNotEmpty()) {
          val runner = runners.firstOrNull { it.id == runnerId }
          FooterPill(Icon.terminal, runner?.displayName, "Runner: ${runner?.displayName ?: "Default"}") { picker = Picker.Runner }
        }
        when (kind) {
          StartWorkspace.Kind.Current -> session?.branch?.let { FooterPill(Icon.branch, it, "Branch $it", onClick = null) }
          StartWorkspace.Kind.Worktree -> {
            val title = StartWorkspace.baseTitle(base ?: preselected, loadingBases)
            FooterPill(Icon.branch, title, "Base branch: ${base ?: preselected ?: "Project default"}") { picker = Picker.Base }
          }
          StartWorkspace.Kind.Existing -> FooterPill(Icon.branch, existing ?: "Pick a branch", "Existing branch", accent = existing == null) { picker = Picker.Existing }
        }
      }
    }
  }

  when (picker) {
    Picker.Project -> PickerSheet("Project", projects.map { PickerOption(it.repoRoot, it.name) }, setOfNotNull(root), { flow.pickProject(it) }, { picker = null })
    Picker.Workspace -> PickerSheet(
      "Workspace",
      flow.options.map { PickerOption(it, kindLabel(it, session?.kind), kindHint(it, session?.branch)) }, setOf(kind), { flow.pick(it) }, { picker = null },
    )
    Picker.Runner -> PickerSheet(
      "Runner",
      listOf(PickerOption("", "Default", "Use the computer's default")) +
        runners.map { PickerOption(it.id, it.displayName, it.pickerHint, disabled = !it.isAvailable) },
      setOf(runnerId ?: ""), { flow.runnerId.value = it.ifEmpty { null } }, { picker = null },
    )
    Picker.Base -> PickerSheet(
      "Base branch",
      (baseOptions.ifEmpty { branches.map { it.name } }).map { PickerOption(it, it) }, setOfNotNull(base ?: preselected),
      { bases.pick(it) }, { picker = null }, emptyMessage = "This project reported no branches.",
    )
    Picker.Existing -> PickerSheet(
      "Existing branch",
      if (branches.isEmpty()) baseOptions.filterNot { it.startsWith("origin/") }.map { PickerOption(it, it) }
      else branches.map { PickerOption(it.name, it.name, if (it.scope == RemoteGitBranchScope.remote) "remote" else it.lastCommitSubject) },
      setOfNotNull(existing), { flow.existingBranch.value = it }, { picker = null }, emptyMessage = "This project reported no branches.",
    )
    null -> Unit
  }
}

@Composable
private fun FooterPill(icon: ImageVector, title: String?, label: String, accent: Boolean = false, onClick: (() -> Unit)?) {
  val theme = ArgusTheme.colors
  Row(
    Modifier.then(if (onClick != null) Modifier.argusClickable(rememberInteraction(), shape = RoundedCornerShape(8.dp), label = label, onClick = onClick) else Modifier)
      .clearAndSetSemantics { contentDescription = label }
      .padding(horizontal = 8.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(icon, null, Modifier.size(14.dp), tint = if (accent) theme.accent else theme.textSecondary)
    if (title != null) {
      Text(title, color = if (accent) theme.accent else theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 1)
      if (onClick != null) Icon(Icon.chevronDown, null, Modifier.size(10.dp), tint = theme.textMuted)
    }
  }
}

private fun kindIcon(kind: StartWorkspace.Kind) = when (kind) {
  StartWorkspace.Kind.Worktree -> Icon.plus
  StartWorkspace.Kind.Existing -> Icon.branch
  StartWorkspace.Kind.Current -> Icon.folder
}

private fun kindLabel(kind: StartWorkspace.Kind, sessionKind: dev.houwert.argus.kit.protocol.generated.RemoteSessionKind?) = when (kind) {
  StartWorkspace.Kind.Current -> StartWorkspace.currentLabel(sessionKind)
  StartWorkspace.Kind.Worktree -> StartWorkspace.WORKTREE_LABEL
  StartWorkspace.Kind.Existing -> StartWorkspace.EXISTING_LABEL
}

private fun kindHint(kind: StartWorkspace.Kind, branch: String?) = when (kind) {
  StartWorkspace.Kind.Current -> branch
  StartWorkspace.Kind.Worktree -> StartWorkspace.WORKTREE_HINT
  StartWorkspace.Kind.Existing -> "Check out a branch in a new worktree"
}
