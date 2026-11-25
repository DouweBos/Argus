package dev.houwert.argus.app.screens.automations

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.stores.loadUpcoming
import dev.houwert.argus.ui.automations.UpcomingRunRow
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import kotlinx.coroutines.launch

/** What runs next across every automation and teammate duty, soonest first, and what each waits on. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpcomingScreen() {
  val store = LocalAppStore.current.automations
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val upcoming by store.upcoming.collectAsState()
  val error by store.error.collectAsState()
  var refreshing by rememberSaveable { mutableStateOf(false) }

  // Opening the screen is the one read that counts as a view.
  LaunchedEffect(access.ready) { if (access.ready) store.loadUpcoming(viewed = true) }

  AutomationsScaffold("Upcoming") {
    PullToRefreshBox(
      refreshing,
      onRefresh = {
        refreshing = true
        scope.launch {
          store.loadUpcoming(viewed = false)
          refreshing = false
        }
      },
      Modifier.fillMaxSize(),
    ) {
      val runs = upcoming.orEmpty()
      LoadPhaseBox(
        upcoming != null, if (upcoming == null) error else null, runs.isEmpty(), Modifier.fillMaxSize(),
        loadingLabel = "Reading what's coming up", failedTitle = "Upcoming runs unavailable",
        onRetry = { scope.launch { store.loadUpcoming(viewed = false) } },
        empty = {
          EmptyState(Icon.clock, "Nothing scheduled", body = "Automations and teammate duties on a schedule show up here.")
        },
      ) {
        LazyColumn(
          Modifier.fillMaxSize(),
          contentPadding = PaddingValues(ArgusMetrics.space),
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          item(key = "runs") {
            ListSection(Modifier.widthIn(max = ArgusMetrics.maxReadingWidth)) {
              for (run in runs) {
                UpcomingRunRow(run) { router.push(Route.Automation(run.automationId, run.name)) }
              }
            }
          }
        }
      }
    }
  }
}
