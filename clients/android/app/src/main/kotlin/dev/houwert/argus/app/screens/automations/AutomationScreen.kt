package dev.houwert.argus.app.screens.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.automations.Autonomy
import dev.houwert.argus.core.automations.isActive
import dev.houwert.argus.core.stores.loadCalibrationOverGateway
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemory
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.automations.CalibrationStats
import dev.houwert.argus.ui.automations.MemoryEditorSheet
import dev.houwert.argus.ui.automations.RunRow
import dev.houwert.argus.ui.components.ArgusSwitch
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * One automation: what it is, when it next fires, its track record, its memories and every
 * time it has run. Acting on it needs control, so without the grant the actions are absent
 * rather than disabled: a monitor device is never going to get them by tapping.
 */
@Composable
fun AutomationScreen(id: String, label: String) {
  val app = LocalAppStore.current
  val store = app.automations
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val automations by store.automations.collectAsState()
  val error by store.error.collectAsState()
  val automation = automations.firstOrNull { it.id == id }
  var duplicating by remember { mutableStateOf(false) }
  // The memory sheet: open with null adds one.
  var memorySheet by remember { mutableStateOf(false) }
  var openMemory by remember { mutableStateOf<RemoteAutomationMemory?>(null) }

  LiveRefresh(enabled = access.ready) {
    store.refresh()
    store.loadMemories(id)
    store.loadCalibrationOverGateway(id)
  }

  AutomationsScaffold(
    automation?.name ?: label,
    actions = {
      if (access.hasControl) {
        IconButton(
          {
            duplicating = true
            scope.launch {
              // Opens the paused copy, ready to be adapted for another project.
              store.duplicate(id)?.let { copy -> router.push(Route.Automation(copy, store.detailById.value[copy]?.name ?: label)) }
              duplicating = false
            }
          },
          enabled = !duplicating && access.ready,
        ) { Icon(Icon.copy, "Duplicate") }
        IconButton({ router.push(Route.AutomationEditor(id, automation?.name ?: label)) }) { Icon(Icon.pencil, "Edit") }
      }
    },
  ) {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
      if (automation == null) {
        Loading("Reading the automation")
      } else {
        Detail(automation, access)
        TrackRecord(id)
        Memories(id, access.hasControl) { memory ->
          openMemory = memory
          memorySheet = true
        }
        Runs(automation, access.hasControl)
      }
    }
  }

  if (memorySheet) {
    MemoryEditorSheet(
      openMemory, access.hasControl, error,
      save = { draft, previous -> store.saveMemory(id, draft, previous) },
      delete = { name -> store.deleteMemory(id, name) },
      onDismiss = { memorySheet = false },
    )
  }
}

@Composable
private fun Detail(automation: RemoteAutomation, access: HostAccess) {
  val store = LocalAppStore.current.automations
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val runs by store.runs.collectAsState()
  val triggering by store.triggering.collectAsState()
  Card {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      val triggerIcon = if (automation.triggerKind == RemoteAutomationTriggerKind.slack) Icon.chat else Icon.clock
      Icon(triggerIcon, null, Modifier.size(15.dp), tint = theme.textSecondary)
      BodyText(Labels.triggerLabel(automation), Modifier.weight(1f))
      if (access.hasControl) {
        // The one dial worth flipping without opening the editor.
        ArgusSwitch(automation.enabled, { enabled -> scope.launch { store.setEnabled(automation.id, enabled) } }, enabled = access.ready)
      } else {
        Badge(if (automation.enabled) "Enabled" else "Paused", tone = if (automation.enabled) Tone.Success else Tone.Muted)
      }
    }
    if (automation.description.isNotEmpty()) MutedText(automation.description)
    val next = if (automation.enabled) Labels.until(automation.nextRunAt) else null
    val autonomy = Autonomy.fromRaw(automation.autonomy?.rawValue)
    if (next != null || autonomy != null) {
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        next?.let { MutedText("Next run $it") }
        autonomy?.let { MutedText("Autonomy: ${it.label}") }
      }
    }
    if (automation.projects.isNotEmpty()) MutedText("Projects: ${automation.projects.joinToString(", ")}", maxLines = 2)

    if (access.hasControl) {
      val active = runs.firstOrNull { it.automationId == automation.id && it.isActive }
      if (active != null) {
        Btn("Cancel run", tone = ButtonTone.Danger, small = true) { scope.launch { store.cancelRun(active.id) } }
      } else {
        val starting = automation.id in triggering
        Btn(
          if (starting) "Starting" else "Run now", small = true, icon = Icon.play, busy = starting,
          enabled = !starting && access.ready,
        ) { scope.launch { store.runNow(automation.id) } }
      }
    }
  }
}

/** How often its proposals were kept versus dismissed: the record that says whether to trust it with more autonomy. */
@Composable
private fun TrackRecord(id: String) {
  val calibration by LocalAppStore.current.automations.calibrationById.collectAsState()
  val record = calibration[id] ?: return
  if (record.sample <= 0) return
  SectionHeader("Track record", count = record.sample.toInt())
  Card { CalibrationStats(record) }
}

@Composable
private fun Memories(id: String, hasControl: Boolean, open: (RemoteAutomationMemory?) -> Unit) {
  val theme = ArgusTheme.colors
  val memoriesById by LocalAppStore.current.automations.memoriesById.collectAsState()
  val items = memoriesById[id].orEmpty()
  SectionHeader("Memories", count = items.size)
  if (items.isEmpty()) MutedText("Nothing yet. Runs save what they learn here so the next one doesn't start from scratch.")
  for (memory in items) {
    Card(onClick = { open(memory) }) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
          memory.name, Modifier.weight(1f), color = theme.text, style = argusFont(13, FontWeight.SemiBold, mono = true),
          maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Badge(memory.type.rawValue)
      }
      MutedText(memory.description, maxLines = 2)
    }
  }
  if (hasControl) Btn("Add memory", tone = ButtonTone.Secondary, small = true, icon = Icon.plus) { open(null) }
}

@Composable
private fun Runs(automation: RemoteAutomation, hasControl: Boolean) {
  val router = LocalRouter.current
  val runs by LocalAppStore.current.automations.runs.collectAsState()
  val items = runs.filter { it.automationId == automation.id }
  if (items.isEmpty()) {
    EmptyState(
      Icon.history, "Never run",
      body = if (hasControl) "Press Run now to see what it does." else "This device can watch automations but not start them.",
    )
    return
  }
  SectionHeader("Run history", count = items.size)
  // One grouped list, as the Mac's run history section.
  ListSection {
    for (run in items) RunRow(run, onClick = { router.push(Route.Run(run.id, automation.name)) })
  }
}
