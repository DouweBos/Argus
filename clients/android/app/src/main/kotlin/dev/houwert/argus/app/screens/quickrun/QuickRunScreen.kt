package dev.houwert.argus.app.screens.quickrun

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import dev.houwert.argus.core.automations.defaultGuardrails
import dev.houwert.argus.core.stores.loadQuickRunsOverGateway
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.kit.util.OnceTime
import dev.houwert.argus.ui.components.ArgusSwitch
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.RunStatusBadge
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.ToggleList
import dev.houwert.argus.ui.components.ToggleOption
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.components.DateTimePickerDialog
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.launch

/**
 * Run a playbook once against the projects you pick, with nothing saved behind it, and the quick
 * runs so far underneath. Autonomy isn't offered: an ad-hoc run inherits the computer's default.
 */
@Composable
fun QuickRunScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val store = app.automations
  val theme = ArgusTheme.colors
  val capabilities by host.capabilities.collectAsState()
  val connection by host.connection.collectAsState()
  val projects by host.projects.collectAsState()
  val error by store.error.collectAsState()
  val sources by store.sources.collectAsState()
  val quickRuns by store.quickRuns.collectAsState()
  val hasControl = "control" in capabilities
  var name by remember { mutableStateOf("") }
  var playbook by remember { mutableStateOf("") }
  var repoRoots by remember { mutableStateOf(emptyList<String>()) }
  var sourceIds by remember { mutableStateOf(emptyList<String>()) }
  var starting by remember { mutableStateOf(false) }
  var runLater by remember { mutableStateOf(false) }
  var picking by remember { mutableStateOf(false) }
  val zone = ZoneId.systemDefault()
  var runAt by remember { mutableStateOf(OnceTime.date(OnceTime.nextWholeHour(timezone = zone.id), zone.id)?.atZone(zone) ?: ZonedDateTime.now(zone).plusHours(1)) }
  val scope = rememberCoroutineScope()
  val canRun = hasControl && playbook.isNotBlank() && !starting
  val label = name.trim().ifEmpty { "Quick run" }

  LaunchedEffect(Unit) {
    store.loadQuickRunsOverGateway()
    store.loadSources()
  }
  LiveRefresh(connection == Transport.State.Ready) { store.loadQuickRunsOverGateway() }

  fun go() {
    starting = true
    scope.launch {
      if (runLater) {
        val id = store.scheduleScratch(label, playbook, repoRoots, sourceIds, OnceTime.string(runAt.toInstant(), zone.id), zone.id)
        starting = false
        if (id != null) { playbook = ""; router.push(Route.Automation(id, label)) }
      } else {
        val runId = store.runScratch(label, playbook, repoRoots, sourceIds, null, defaultGuardrails)
        starting = false
        // Straight to the run: watching it is the point of pressing the button.
        if (runId != null) { playbook = ""; router.push(Route.Run(runId, label)) }
      }
    }
  }

  TopBarScreen("Quick Run", onBack = router::pop) {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger) }
      Field(
        "What should it do?",
        caption = "Nothing is saved, but you can turn a run into an automation afterwards. The run reads the projects at their paths and never writes to them.",
      ) {
        ThemedTextField(name, { name = it }, "Quick run", input = TextInput.Name, enabled = hasControl)
        ThemedTextField(playbook, { playbook = it }, "Summarise what landed on each project this week.", multiline = true, lines = 6..24, mono = true, enabled = hasControl)
      }
      Field("Scope", caption = "Repos the run may read, and what feeds it work.") {
        ToggleList(projectOptions(projects, repoRoots), repoRoots, { repoRoots = it }, title = "Projects", emptyMessage = "This computer has no projects registered.")
        if (sources.isNotEmpty()) {
          ToggleList(sources.map { ToggleOption(it.id, it.label, if (it.available) null else "not configured") }, sourceIds, { sourceIds = it }, title = "Signal sources")
        }
      }
      if (hasControl) {
        Field("When", caption = if (runLater) "Saved as an automation that runs once at this time, then pauses itself." else null) {
          Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
            Text("Run later", Modifier.weight(1f), color = theme.text, style = ArgusTheme.typography.subheadline)
            ArgusSwitch(runLater, { runLater = it })
          }
          if (runLater) {
            Row(
              Modifier.fillMaxWidth().argusClickable(rememberInteraction(), label = "Run at") { picking = true }.padding(vertical = 10.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Text("Run at", Modifier.weight(1f), color = theme.text, style = ArgusTheme.typography.subheadline)
              Text(runAt.format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)), color = theme.accent, style = ArgusTheme.typography.subheadline)
            }
          }
        }
        Btn(if (starting) (if (runLater) "Scheduling" else "Starting") else if (runLater) "Run later" else "Run once", icon = Icon.play, enabled = canRun, busy = starting) { go() }
      }
      SectionHeader("Quick runs", count = quickRuns?.size)
      when {
        quickRuns == null -> Loading("Reading quick runs")
        quickRuns!!.isEmpty() -> MutedText("Nothing yet. A quick run is kept and swept like any other run.")
        else -> Card { quickRuns!!.forEach { QuickRunRow(it) { router.push(Route.Run(it.id, it.automationName)) } } }
      }
    }
  }
  if (picking) DateTimePickerDialog("Run at", runAt, "Done", { runAt = it }, { picking = false })
}

/** Every project, plus picked roots the computer no longer lists, so a stale pick can be cleared. */
fun projectOptions(projects: List<RemoteProject>, picked: List<String>): List<ToggleOption> {
  val known = projects.map { it.repoRoot }.toSet()
  return projects.map { ToggleOption(it.repoRoot, it.name, icon = Icon.folder) } +
    picked.filter { it !in known }.map { ToggleOption(it, it.substringAfterLast('/'), "not on this computer", Icon.folder) }
}

@Composable
private fun QuickRunRow(run: RemoteAutomationRun, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  Row(
    Modifier.fillMaxWidth().argusClickable(rememberInteraction(), label = run.automationName, onClick = onClick).padding(vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
  ) {
    RunStatusBadge(run.status)
    Text(run.automationName, Modifier.weight(1f), color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
    Text(Labels.timeAgo(run.startedAt), color = theme.textMuted, style = ArgusTheme.typography.caption)
  }
}

