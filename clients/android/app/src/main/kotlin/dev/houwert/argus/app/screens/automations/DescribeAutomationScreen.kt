package dev.houwert.argus.app.screens.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.automations.hasValidTrigger
import dev.houwert.argus.core.automations.schedulePreviewText
import dev.houwert.argus.core.automations.signalEventOptions
import dev.houwert.argus.core.automations.withAutonomy
import dev.houwert.argus.core.stores.draftOverGateway
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.automations.AutomationText
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import java.util.TimeZone
import kotlinx.coroutines.launch

/**
 * "Describe it": a sentence in, a draft automation out, reviewed right underneath. It saves
 * paused: a generated automation is never live on arrival. Drafting spends the computer's
 * Claude account, so this needs control.
 */
@Composable
fun DescribeAutomationScreen() {
  val store = LocalAppStore.current.automations
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val error by store.error.collectAsState()
  var text by rememberSaveable { mutableStateOf("") }
  var draft by remember { mutableStateOf<RemoteAutomationDetail?>(null) }
  var notes by remember { mutableStateOf(emptyList<String>()) }
  var working by remember { mutableStateOf(false) }

  AutomationsScaffold(
    "Describe an Automation",
    actions = {
      if (draft != null) {
        BarTextAction("Create", enabled = !working && draft?.hasValidTrigger == true) {
          val input = draft ?: return@BarTextAction
          // Saved paused and inheriting the computer's autonomy, whatever the draft said.
          val toSave = input.copy(name = input.name.ifBlank { "New automation" }, enabled = false).withAutonomy(null)
          working = true
          scope.launch {
            val id = store.save(null, toSave)
            working = false
            if (id != null) router.replaceTop(Route.Automation(id, toSave.name), 1)
          }
        }
      }
    },
  ) {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
      Field("What should it do?", caption = "One or two sentences. Say when it should run and what you want back.") {
        ThemedTextField(
          text, { text = it }, "Every weekday at 8am, look at my open PRs and tell me which ones have gone stale.",
          multiline = true, lines = 2..6,
        )
        if (working) {
          Loading("Drafting it")
        } else {
          Btn(
            if (draft == null) "Draft it" else "Regenerate", tone = if (draft == null) ButtonTone.Primary else ButtonTone.Secondary,
            small = true, icon = Icon.agent, enabled = text.isNotBlank(),
          ) {
            val regenerating = draft != null
            working = true
            scope.launch {
              store.draftOverGateway(text, regenerating)?.let {
                draft = it.automation
                notes = it.notes
              }
              working = false
            }
          }
        }
      }
      draft?.let { current -> Review(current, notes) { draft = it } }
    }
  }
}

@Composable
private fun Review(draft: RemoteAutomationDetail, notes: List<String>, onChange: (RemoteAutomationDetail) -> Unit) {
  if (notes.isNotEmpty()) Banner(notes.joinToString("\n"), tone = Tone.Muted, title = "Adjusted while drafting")
  Field("Draft") {
    ThemedTextField(draft.name, { onChange(draft.copy(name = it)) }, "Name", input = TextInput.Name)
    ThemedTextField(draft.description, { onChange(draft.copy(description = it)) }, "Description", multiline = true)
    val cron = draft.cron
    if (draft.triggerKind == RemoteAutomationTriggerKind.schedule && cron != null) {
      Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        draft.schedulePreviewText()?.headline?.let { BodyText(it) }
        MonoText("$cron · ${draft.timezone ?: TimeZone.getDefault().id}", color = ArgusTheme.colors.textMuted)
      }
    } else if (draft.triggerKind == RemoteAutomationTriggerKind.slack) {
      BodyText(Labels.slackTriggerLabel(draft.slackChannel, draft.slackMatch, draft.slackText))
    } else {
      MutedText(
        when (draft.triggerKind) {
          RemoteAutomationTriggerKind.signal -> "On events: " +
            signalEventOptions.filter { it.first in draft.signal?.on.orEmpty() }.joinToString(", ") { it.second }
          RemoteAutomationTriggerKind.webhook -> "On webhook: runs when its URL is called. Generate its secret once saved."
          else -> "Manual: runs only when someone presses Run now."
        }
      )
    }
    ThemedTextField(draft.playbook, { onChange(draft.copy(playbook = it)) }, "Playbook", multiline = true, lines = 6..24, mono = true)
  }
  MutedText("${scopeLabel(draft)} · autonomy inherits the computer's default. Saves paused: turn it on once you have read it.")
}

private fun scopeLabel(draft: RemoteAutomationDetail): String {
  val projects = draft.repoRoots.size
  val sources = draft.sourceIds.size
  return (if (projects == 0) "No projects" else AutomationText.plural(projects, "project")) + " · " +
    (if (sources == 0) "no signal sources" else AutomationText.plural(sources, "source"))
}
