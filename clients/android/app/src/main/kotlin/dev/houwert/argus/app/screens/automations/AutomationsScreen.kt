package dev.houwert.argus.app.screens.automations

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.teammates.TeammatesEntryRow
import dev.houwert.argus.core.automations.isActive
import dev.houwert.argus.ui.automations.AutomationRow
import dev.houwert.argus.ui.automations.RunRow
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** Folded so the runs don't push the automations themselves off screen. */
private const val RECENT_RUNS = 3

/**
 * The connected computer's automations, and what they have been doing: the one thing in
 * Argus that happens while nobody is looking, which is exactly what you check from a phone.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AutomationsScreen() {
  val store = LocalAppStore.current.automations
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val automations by store.automations.collectAsState()
  val runs by store.runs.collectAsState()
  val loaded by store.loaded.collectAsState()
  val error by store.error.collectAsState()
  val triggering by store.triggering.collectAsState()
  val teammatesStore = LocalAppStore.current.teammates
  val teammates by teammatesStore.teammates.collectAsState()
  val teammatesLoaded by teammatesStore.loaded.collectAsState()
  val teammatesError by teammatesStore.error.collectAsState()
  var showingAllRuns by rememberSaveable { mutableStateOf(false) }
  var refreshing by rememberSaveable { mutableStateOf(false) }
  // A computer too old to answer `teammates.list` gets no entry.
  val showsTeammates = teammatesLoaded && (teammatesError == null || teammates.isNotEmpty())

  LiveRefresh(enabled = access.ready) {
    store.refresh()
    teammatesStore.refresh()
  }

  AutomationsScaffold("Automations", actions = { if (access.hasControl) NewMenu(offersTeammates = showsTeammates) }) {
    PullToRefreshBox(
      refreshing,
      onRefresh = {
        refreshing = true
        scope.launch {
          store.refresh()
          refreshing = false
        }
      },
      Modifier.fillMaxSize(),
    ) {
      LoadPhaseBox(
        // The teammates entry counts as content, so it stays reachable with no automations.
        loaded, error, automations.isEmpty() && runs.isEmpty() && !showsTeammates, Modifier.fillMaxSize(),
        loadingLabel = "Reading automations", failedTitle = "Automations unavailable",
        onRetry = { scope.launch { store.refresh() } },
        empty = { EmptyState(Icon.automations, "No automations", body = "Use + to run a playbook once, or to set one on a schedule.") },
      ) {
        LazyColumn(
          Modifier.fillMaxSize(),
          contentPadding = PaddingValues(ArgusMetrics.space),
          verticalArrangement = Arrangement.spacedBy(20.dp),
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          error?.let { message -> item { Banner(message, Modifier.widthIn(max = ArgusMetrics.maxReadingWidth), tone = Tone.Danger, onDismiss = store::clearError) } }
          if (showsTeammates) {
            item(key = "teammates") {
              ListSection(Modifier.widthIn(max = ArgusMetrics.maxReadingWidth)) {
                TeammatesEntryRow(teammates) { router.push(Route.Teammates) }
              }
            }
          }
          if (automations.isNotEmpty()) {
            item(key = "automations") {
              // Alone on the screen a header would only repeat the title.
              ListSection(Modifier.widthIn(max = ArgusMetrics.maxReadingWidth), header = if (runs.isNotEmpty()) "Automations" else null) {
                for (automation in automations) {
                  val latest = runs.firstOrNull { it.automationId == automation.id }
                  AutomationRow(
                    automation, lastRun = latest?.status, lastRunAt = latest?.startedAt,
                    onClick = { router.push(Route.Automation(automation.id, automation.name)) },
                    trailing = if (access.hasControl && latest?.isActive != true) {
                      {
                        IconBtn(
                          Icon.play, "Run ${automation.name} now", size = 18.dp, tint = ArgusTheme.colors.accent,
                          enabled = automation.id !in triggering && access.ready,
                        ) { scope.launch { store.runNow(automation.id) } }
                      }
                    } else null,
                  )
                }
              }
            }
          }
          if (runs.isNotEmpty()) {
            item(key = "runs") {
              ListSection(Modifier.widthIn(max = ArgusMetrics.maxReadingWidth).animateContentSize(), header = "Recent runs") {
                for (run in if (showingAllRuns) runs else runs.take(RECENT_RUNS)) {
                  RunRow(run, onClick = { router.push(Route.Run(run.id, run.automationName)) }, showName = true)
                }
                if (runs.size > RECENT_RUNS) {
                  Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
                    AccentLink(if (showingAllRuns) "Show fewer" else "See all ${runs.size}") { showingAllRuns = !showingAllRuns }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

/** Quick Run, a new automation, or one described in a sentence. */
@Composable
private fun NewMenu(offersTeammates: Boolean) {
  val router = LocalRouter.current
  var open by rememberSaveable { mutableStateOf(false) }
  Box {
    IconButton({ open = true }) { Icon(Icon.plus, "New") }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
      // Closing before pushing keeps the menu from reopening when the user comes back.
      fun pick(route: Route) {
        open = false
        router.push(route)
      }
      MenuItem("Quick Run", Icon.play) { pick(Route.QuickRun) }
      MenuItem("New Automation", Icon.clock) { pick(Route.AutomationEditor(null, "New Automation")) }
      MenuItem("Describe it", Icon.agent) { pick(Route.DescribeAutomation) }
      if (offersTeammates) MenuItem("New Teammate", Icon.person) { pick(Route.TeammateGallery) }
    }
  }
}

@Composable
private fun MenuItem(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
  DropdownMenuItem(text = { Text(label) }, leadingIcon = { Icon(icon, null) }, onClick = onClick)
}
