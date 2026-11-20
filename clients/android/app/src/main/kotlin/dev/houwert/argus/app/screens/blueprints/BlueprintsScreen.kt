package dev.houwert.argus.app.screens.blueprints

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.inbox.TopBarScaffold
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.ui.blueprints.BlueprintRow
import dev.houwert.argus.ui.blueprints.BlueprintSymbol
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** `/blueprints`: the computer's recipes for new projects, each one a tap from a new project. Writing one needs control. */
@Composable
fun BlueprintsScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val store = app.blueprints
  val scope = rememberCoroutineScope()
  val connection by app.host.connection.collectAsState()
  val capabilities by app.host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  val blueprints by store.blueprints.collectAsState()
  val loaded by store.loaded.collectAsState()
  val error by store.error.collectAsState()
  val drafting by store.drafting.collectAsState()
  val pendingDraft by store.pendingDraft.collectAsState()

  LiveRefresh(enabled = connection == Transport.State.Ready) { store.refresh() }

  TopBarScaffold(
    Route.Blueprints, "Blueprints", onRefresh = { store.refresh() },
    actions = { if (hasControl) NewBlueprintMenu(onNew = { router.push(Route.Blueprint(null)) }, onGenerate = { router.push(Route.GenerateBlueprint) }) },
  ) {
    LoadPhaseBox(
      loaded, error, blueprints.isEmpty(), Modifier.fillMaxSize(),
      loadingLabel = "Reading blueprints", failedTitle = "Blueprints unavailable", onRetry = { scope.launch { store.refresh() } },
      empty = {
        EmptyState(
          BlueprintSymbol.blueprint, "No blueprints",
          body = "A blueprint is a recipe for a new project: where it goes, which projects it copies from, and what the first agent does.",
        ) {
          if (hasControl) {
            Btn("Generate from projects", icon = ArgusIcon.draft, hugs = true) { router.push(Route.GenerateBlueprint) }
            Btn("New blueprint", tone = ButtonTone.Secondary, icon = ArgusIcon.plus, hugs = true) { router.push(Route.Blueprint(null)) }
          }
        }
      },
    ) {
      Screen {
        error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
        // A draft started on the generate screen keeps going after leaving it.
        when {
          drafting -> Loading("Drafting a blueprint")
          pendingDraft != null && hasControl ->
            Banner(
              "Claude finished drafting a blueprint.", tone = Tone.Accent, actionLabel = "Review",
              onAction = { router.push(Route.Blueprint(null)) },
            )
        }
        ListSection {
          blueprints.forEach { blueprint ->
            BlueprintRow(
              blueprint,
              onClick = { router.push(Route.Blueprint(blueprint.id)) },
              onNewProject = if (hasControl) ({ router.push(Route.NewProject(blueprint.id)) }) else null,
            )
          }
        }
      }
    }
  }
}

@Composable
private fun NewBlueprintMenu(onNew: () -> Unit, onGenerate: () -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    IconBtn(ArgusIcon.plus, "New", tint = ArgusTheme.colors.accent) { open = true }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
      DropdownMenuItem(
        text = { Text("New blueprint") }, leadingIcon = { Icon(ArgusIcon.plus, null) },
        onClick = {
          open = false
          onNew()
        },
      )
      DropdownMenuItem(
        text = { Text("Generate from projects") }, leadingIcon = { Icon(ArgusIcon.draft, null) },
        onClick = {
          open = false
          onGenerate()
        },
      )
    }
  }
}
