package dev.houwert.argus.app.screens.newproject

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.blueprints.BlueprintForm
import dev.houwert.argus.core.blueprints.label
import dev.houwert.argus.core.stores.BlueprintsStore
import dev.houwert.argus.core.stores.refreshProjects
import dev.houwert.argus.kit.protocol.generated.BlueprintRun
import dev.houwert.argus.kit.protocol.generated.BlueprintRunStatus
import dev.houwert.argus.kit.protocol.generated.BlueprintStepStatus
import dev.houwert.argus.ui.components.ArgusSwitch
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.TitleText
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * `/blueprints/new-project`: name a project, pick its blueprint, and watch the computer check,
 * create the repository, add it to Argus and start the agent. Lands on the new session once it's up.
 */
@Composable
fun NewProjectScreen(initialBlueprintId: String?) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val store = app.blueprints
  val capabilities by host.capabilities.collectAsState()
  val blueprints by store.blueprints.collectAsState()
  val loaded by store.loaded.collectAsState()
  val error by store.error.collectAsState()
  val runs by store.runs.collectAsState()
  val hasControl = "control" in capabilities
  var blueprintId by remember { mutableStateOf(initialBlueprintId) }
  var request by remember { mutableStateOf(BlueprintsStore.ProjectRequest()) }
  var starting by remember { mutableStateOf(false) }
  var runId by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val blueprint = blueprintId?.let { id -> blueprints.firstOrNull { it.id == id } } ?: blueprints.firstOrNull()
  val canCreate = hasControl && blueprint != null && request.nameProblem == null && !starting
  val run = runId?.let { id -> runs.firstOrNull { it.id == id } }

  LaunchedEffect(Unit) { if (!loaded) store.refresh() }
  LaunchedEffect(runId) { runId?.let { store.watch(it) } }
  // Swaps this screen for what it made, so back skips a finished flow.
  fun open(run: BlueprintRun) {
    val route = run.sessionId?.let { Route.Session(it, run.projectName, run.repoRoot) } ?: Route.Project(run.repoRoot, run.projectName)
    router.replaceTop(route, 1)
  }
  LaunchedEffect(run?.status) {
    if (run?.status == BlueprintRunStatus.done) {
      host.refreshProjects()
      open(run)
    }
  }

  TopBarScreen(
    "New Project", onBack = router::pop,
    actions = {
      if (runId == null && hasControl && blueprint != null) {
        Btn(if (starting) "Creating" else "Create", Modifier.padding(end = 8.dp), small = true, hugs = true, enabled = canCreate) {
          starting = true
          scope.launch {
            val created = store.createProject(blueprint.id, request)
            starting = false
            if (created != null) runId = created.id
          }
        }
      }
    },
  ) {
    if (runId != null) {
      Screen {
        if (run == null) {
          Loading("Starting the project")
        } else {
          Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            TitleText(run.projectName)
            MutedText(run.repoRoot, maxLines = 1)
          }
          BlueprintRunSteps(run)
          if (run.status == BlueprintRunStatus.failed) {
            Btn("Try Again", tone = ButtonTone.Secondary, small = true, icon = Icon.refresh, hugs = true) { runId = null }
          } else if (run.status == BlueprintRunStatus.done) {
            Btn(if (run.sessionId == null) "Open Project" else "Open Session", small = true, hugs = true) { open(run) }
          }
        }
      }
      return@TopBarScreen
    }
    when {
      blueprints.isEmpty() && !loaded -> Loading("Reading blueprints")
      blueprints.isEmpty() && error != null -> EmptyState(Icon.warning, "Blueprints unavailable", body = error)
      blueprints.isEmpty() -> EmptyState(
        Icon.blueprint, "No blueprints",
        body = "A new project starts from a blueprint. Write one, or let Claude draft one from your projects.",
      ) {
        if (hasControl) {
          Btn("Generate from Projects", icon = Icon.draft, hugs = true) { router.push(Route.GenerateBlueprint) }
          Btn("New Blueprint", tone = ButtonTone.Secondary, icon = Icon.plus, hugs = true) { router.push(Route.Blueprint(null)) }
        }
      }
      blueprint != null -> Form(blueprint, blueprints, request, hasControl, error, { blueprintId = it }, { request = it })
    }
  }
}

@Composable
private fun Form(
  blueprint: dev.houwert.argus.kit.protocol.generated.Blueprint,
  blueprints: List<dev.houwert.argus.kit.protocol.generated.Blueprint>,
  request: BlueprintsStore.ProjectRequest,
  hasControl: Boolean,
  error: String?,
  pick: (String) -> Unit,
  update: (BlueprintsStore.ProjectRequest) -> Unit,
) {
  val theme = ArgusTheme.colors
  var overrides by remember { mutableStateOf(false) }
  Screen {
    error?.let { Banner(it, tone = Tone.Danger) }
    Field("Blueprint", caption = blueprint.summary.ifEmpty { null }) {
      MenuChip("Blueprint", blueprint.id, blueprints.map { PickerOption(it.id, it.name) }, pick, icon = Icon.blueprint)
    }
    Field(
      "Project",
      caption = if (request.name.isNotEmpty() && request.nameProblem != null) request.nameProblem else "The description goes to the agent with the blueprint's instructions.",
    ) {
      ThemedTextField(request.name, { update(request.copy(name = it)) }, "my-new-app", mono = true, input = TextInput.Code, enabled = hasControl)
      ThemedTextField(request.description, { update(request.copy(description = it)) }, "What it is, in a sentence or two", multiline = true, lines = 3..8, enabled = hasControl)
    }
    Row(
      Modifier.fillMaxWidth().argusClickable(rememberInteraction(), label = "Override for this project") { overrides = !overrides }.padding(vertical = 8.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(if (overrides) Icon.chevronDown else Icon.chevronRight, null, Modifier.size(12.dp), tint = theme.textMuted)
      Text("Override for this project", color = theme.text, style = ArgusTheme.typography.body)
    }
    if (overrides) {
      val github = request.githubEnabled ?: blueprint.github.enabled
      Field("Folder") {
        ThemedTextField(request.parentDir.orEmpty(), { update(request.copy(parentDir = it.ifEmpty { null })) }, blueprint.parentDir, mono = true, input = TextInput.Code, enabled = hasControl)
      }
      Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Text("Create a GitHub repository", Modifier.weight(1f), color = theme.text, style = ArgusTheme.typography.subheadline)
        ArgusSwitch(github, { update(request.copy(githubEnabled = if (it == blueprint.github.enabled) null else it)) }, enabled = hasControl)
      }
      if (github) {
        Field("Owner") {
          ThemedTextField(request.owner.orEmpty(), { update(request.copy(owner = it.ifEmpty { null })) }, blueprint.github.owner.ifEmpty { "Your account" }, input = TextInput.Name, enabled = hasControl)
        }
        val fallback = BlueprintForm.Visibility.fromRaw(blueprint.github.visibility.rawValue)
        MenuChip(
          "Visibility", request.visibility ?: fallback, BlueprintForm.Visibility.entries.map { PickerOption(it, it.label) },
          { update(request.copy(visibility = if (it == fallback) null else it)) }, showsTitle = true,
        )
      }
    }
  }
}

/** A blueprint run's steps, each with its state and, when one failed, why. */
@Composable
fun BlueprintRunSteps(run: BlueprintRun) {
  val theme = ArgusTheme.colors
  Card {
    run.steps.forEachIndexed { index, step ->
      if (index > 0) HorizontalDivider(color = theme.borderSubtle)
      Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
          when (step.status) {
            BlueprintStepStatus.running -> CircularProgressIndicator(Modifier.size(16.dp), color = theme.accent, strokeWidth = 2.dp)
            BlueprintStepStatus.done -> Icon(Icon.check, "Done", Modifier.size(18.dp), tint = theme.success)
            BlueprintStepStatus.failed -> Icon(Icon.close, "Failed", Modifier.size(18.dp), tint = theme.error)
            else -> Icon(Icon.clock, "Waiting", Modifier.size(16.dp), tint = theme.textMuted)
          }
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
          Text(step.key.label, color = if (step.status == BlueprintStepStatus.pending) theme.textMuted else theme.text, style = ArgusTheme.typography.subheadline)
          step.error?.takeIf { it.isNotEmpty() }?.let { Text(it, color = theme.error, style = ArgusTheme.typography.footnote, overflow = TextOverflow.Clip) }
        }
      }
    }
  }
}
