package dev.houwert.argus.app.screens.blueprints

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.inbox.TopBarScaffold
import dev.houwert.argus.core.blueprints.BlueprintForm
import dev.houwert.argus.ui.blueprints.BlueprintRunRow
import dev.houwert.argus.ui.blueprints.BlueprintSymbol
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SettingsPage
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * `/blueprints/:id`, or `/blueprints/new`: one blueprint, every field editable, and the projects
 * made from it. Nothing saves until Save. A monitor device reads it; writing needs control.
 */
@Composable
fun BlueprintEditorScreen(id: String?) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val store = app.blueprints
  val scope = rememberCoroutineScope()
  val capabilities by app.host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  val error by store.error.collectAsState()
  val runners by app.automations.runners.collectAsState()
  val runs by store.runs.collectAsState()

  var form by remember(id) { mutableStateOf(BlueprintForm()) }
  var loaded by remember(id) { mutableStateOf(false) }
  var saving by remember { mutableStateOf(false) }
  var confirmingDelete by rememberSaveable { mutableStateOf(false) }
  val canSave = hasControl && form.problem == null && !saving

  LaunchedEffect(id) {
    if (loaded) return@LaunchedEffect
    if (app.automations.runners.value.isEmpty()) app.automations.loadRunners()
    if (id != null) {
      if (store.blueprint(id) == null) store.refresh()
      store.blueprint(id)?.let { form = BlueprintForm.from(it) }
    } else {
      store.pendingDraft.value?.let {
        form = it
        store.pendingDraft.value = null
      }
    }
    loaded = true
  }

  val title = when {
    id == null -> "New blueprint"
    form.name.isEmpty() -> "Blueprint"
    else -> form.name
  }
  TopBarScaffold(
    Route.Blueprint(id), title,
    actions = {
      if (hasControl) {
        AccentLink(if (saving) "Saving" else "Save", Modifier.padding(end = 12.dp), enabled = canSave) {
          saving = true
          scope.launch {
            val saved = store.save(id, form)
            saving = false
            if (saved != null) router.pop()
          }
        }
      }
    },
  ) {
    SettingsPage {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
      if (!loaded) {
        Loading("Reading the blueprint")
        return@SettingsPage
      }
      if (form.fromDraft) Banner("Claude drafted this from your projects. Read it through before saving.", tone = Tone.Muted, title = "Draft")
      if (id != null && hasControl) {
        Btn("New project from this blueprint", tone = ButtonTone.Secondary, icon = BlueprintSymbol.newProject) {
          router.push(Route.NewProject(id))
        }
      }
      BlueprintFormSections(form, { form = it }, runners, enabled = hasControl)
      val history = if (id == null) emptyList() else runs.filter { it.blueprintId == id }
      if (history.isNotEmpty()) {
        ListSection(header = "Projects made from it") {
          history.forEach { run ->
            val sessionId = run.sessionId
            BlueprintRunRow(run, onClick = sessionId?.let { { router.push(Route.Session(it, run.projectName, run.repoRoot)) } })
          }
        }
      }
      form.problem?.takeIf { hasControl }?.let { MutedText(it) }
      if (id != null && hasControl) {
        Btn("Delete blueprint", tone = ButtonTone.Danger) { confirmingDelete = true }
      }
    }
  }

  if (confirmingDelete && id != null) {
    AlertDialog(
      onDismissRequest = { confirmingDelete = false },
      title = { Text("Delete this blueprint?") },
      text = { Text("Projects already made from it stay where they are.") },
      confirmButton = {
        TextButton(onClick = {
          confirmingDelete = false
          scope.launch { if (store.delete(id)) router.pop() }
        }) { Text("Delete", color = ArgusTheme.colors.error) }
      },
      dismissButton = { TextButton(onClick = { confirmingDelete = false }) { Text("Cancel") } },
      containerColor = ArgusTheme.colors.surface,
      titleContentColor = ArgusTheme.colors.text,
      textContentColor = ArgusTheme.colors.textSecondary,
    )
  }
}
