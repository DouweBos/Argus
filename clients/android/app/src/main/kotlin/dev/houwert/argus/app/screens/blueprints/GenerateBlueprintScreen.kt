package dev.houwert.argus.app.screens.blueprints

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.inbox.TopBarScaffold
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.argusToggleable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.inbox.ProposalText
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * `/blueprints/generate`: pick projects, and Claude reads them and drafts a blueprint, which opens
 * in the editor for review. Needs control: drafting spends the computer's Claude account.
 */
@Composable
fun GenerateBlueprintScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val store = app.blueprints
  val scope = rememberCoroutineScope()
  val capabilities by app.host.capabilities.collectAsState()
  val projects by app.host.projects.collectAsState()
  val projectsLoaded by app.host.projectsLoaded.collectAsState()
  val error by store.error.collectAsState()
  val storeDrafting by store.drafting.collectAsState()
  var picked by rememberSaveable { mutableStateOf(listOf<String>()) }
  var working by remember { mutableStateOf(false) }
  val drafting = working || storeDrafting
  val canDraft = !drafting && picked.isNotEmpty() && "control" in capabilities

  TopBarScaffold(
    Route.GenerateBlueprint, "Generate blueprint",
    actions = {
      AccentLink(if (drafting) "Drafting" else "Draft", Modifier.padding(end = 12.dp), enabled = canDraft) {
        working = true
        val paths = picked
        scope.launch {
          val drafted = store.draft(paths)
          working = false
          // Only while this screen is still in front; the draft waits in the store otherwise.
          if (drafted && router.frontRoute == Route.GenerateBlueprint) router.replaceTop(Route.Blueprint(null), 1)
        }
      }
    },
  ) {
    if (projectsLoaded && projects.isEmpty()) {
      EmptyState(ArgusIcon.folder, "No projects", Modifier.fillMaxSize(), body = "Open a repository in Argus on the computer to draft a blueprint from it.")
      return@TopBarScaffold
    }
    Screen {
      if (error != null && !drafting) Banner(error!!, tone = Tone.Danger, onDismiss = store::clearError)
      if (drafting) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Loading("Claude is reading ${ProposalText.plural(picked.size, "project")}")
          MutedText("This takes a minute or two. The draft opens for review when it's ready.")
        }
      }
      val all = projects.map { it.repoRoot }
      val everything = all.isNotEmpty() && all.all { it in picked }
      Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("Projects", Modifier.weight(1f), color = ArgusTheme.colors.textMuted, style = ArgusTheme.typography.footnote)
        if (all.size > 1) {
          AccentLink(if (everything) "Clear" else "Select all", Modifier.padding(end = 8.dp), enabled = !drafting, size = 13) {
            picked = if (everything) emptyList() else all
          }
        }
        Text("${picked.size} of ${all.size}", color = ArgusTheme.colors.textMuted, style = ArgusTheme.typography.footnote)
      }
      ListSection(footer = "Claude looks at what these have in common: layout, tooling, release setup and settings.") {
        projects.forEach { project ->
          ProjectPick(project, project.repoRoot in picked, enabled = !drafting) { on ->
            picked = if (on) picked + project.repoRoot else picked - project.repoRoot
          }
        }
      }
    }
  }
}

@Composable
private fun ProjectPick(project: RemoteProject, on: Boolean, enabled: Boolean, onToggle: (Boolean) -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    Modifier.fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .argusToggleable(on, interaction, enabled, onValueChange = onToggle)
      .padding(horizontal = 16.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(ArgusIcon.folder, null, Modifier.size(18.dp), tint = theme.textSecondary)
    Text(project.name, Modifier.weight(1f), color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
    Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
      Icon(
        SfSymbol[if (on) "checkmark.circle.fill" else "circle"], null, Modifier.size(22.dp),
        tint = if (on) theme.accent else theme.textMuted,
      )
    }
  }
}
