package dev.houwert.argus.app.screens.teammates

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.app.screens.automations.rememberHostAccess
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.ui.automations.AutomationRow
import dev.houwert.argus.ui.automations.ConfirmDialog
import dev.houwert.argus.ui.automations.RunRow
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** How many runs the combined history shows; each duty's screen has the rest. */
private const val RECENT_RUNS = 10

/**
 * A teammate's duties: the automations it runs, and their runs together. A duty opens the
 * automation's own screen; with control one can be detached to stand on its own.
 */
@Composable
fun TeammateDutiesScreen(id: String, label: String) {
  val app = LocalAppStore.current
  val store = app.teammates
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val detailById by store.detailById.collectAsState()
  val error by store.error.collectAsState()
  val runs by app.automations.runs.collectAsState()
  var removing by remember { mutableStateOf<RemoteAutomation?>(null) }
  val detail = detailById[id]
  val name = detail?.teammate?.name ?: label

  LiveRefresh(enabled = access.ready) {
    store.loadDetail(id)
    app.automations.refresh()
  }

  AppScreen("Duties") {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
      when {
        detail == null -> Loading("Reading $name")
        detail.duties.isEmpty() -> EmptyState(
          Icon.automations, "No duties", body = "Give $name an automation from Argus on the Mac, and it shows here.",
        )
        else -> {
          ListSection(header = "Duties") {
            for (duty in detail.duties) {
              val latest = runs.firstOrNull { it.automationId == duty.id }
              AutomationRow(
                duty, lastRun = latest?.status, lastRunAt = latest?.startedAt,
                onClick = { router.push(Route.Automation(duty.id, duty.name)) },
                trailing = if (access.hasControl) ({ DutyMenu(duty) { removing = duty } }) else null,
              )
            }
          }
          val dutyIds = detail.duties.map { it.id }.toSet()
          val dutyRuns = runs.filter { it.automationId in dutyIds }.take(RECENT_RUNS)
          if (dutyRuns.isNotEmpty()) {
            ListSection(header = "Recent runs") {
              for (run in dutyRuns) RunRow(run, onClick = { router.push(Route.Run(run.id, run.automationName)) }, showName = true)
            }
          }
        }
      }
    }
  }

  removing?.let { duty ->
    ConfirmDialog(
      "Remove ${duty.name} from $name?", "It stays as an automation of its own, with its runs and reports.", "Remove",
      onConfirm = {
        removing = null
        scope.launch { store.removeDuty(id, duty.id) }
      },
      onDismiss = { removing = null },
    )
  }
}

@Composable
private fun DutyMenu(duty: RemoteAutomation, remove: () -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    IconButton({ open = true }) { Icon(Icon.ellipsis, "More for ${duty.name}") }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
      DropdownMenuItem(
        text = { Text("Remove from teammate") },
        leadingIcon = { Icon(Icon.close, null) },
        onClick = {
          open = false
          remove()
        },
      )
    }
  }
}
