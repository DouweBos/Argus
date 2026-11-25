package dev.houwert.argus.app.screens.teammates

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.app.screens.automations.rememberHostAccess
import dev.houwert.argus.app.screens.home.PressableRow
import dev.houwert.argus.kit.protocol.generated.TeammateSummary
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.teammates.TeammateAvatar
import dev.houwert.argus.ui.teammates.TeammateRow
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * The connected computer's teammates: named agents that own automations and share one memory.
 * Under the Automations tab, since that's what they run.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeammatesScreen() {
  val store = LocalAppStore.current.teammates
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val teammates by store.teammates.collectAsState()
  val loaded by store.loaded.collectAsState()
  val error by store.error.collectAsState()
  var refreshing by rememberSaveable { mutableStateOf(false) }

  LiveRefresh(enabled = access.ready) { store.refresh() }

  AppScreen(
    "Teammates",
    actions = {
      if (access.hasControl) IconButton({ router.push(Route.TeammateGallery) }) { Icon(Icon.plus, "New Teammate") }
    },
  ) {
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
        loaded, error, teammates.isEmpty(), Modifier.fillMaxSize(),
        loadingLabel = "Reading teammates", failedTitle = "Teammates unavailable",
        onRetry = { scope.launch { store.refresh() } },
        empty = {
          val body = "A teammate is a named agent you can talk to, with its own memory and duties."
          EmptyState(Icon.person, "No teammates", body = if (access.hasControl) "$body Use + to pick one." else body)
        },
      ) {
        LazyColumn(
          Modifier.fillMaxSize(),
          contentPadding = PaddingValues(ArgusMetrics.space),
          verticalArrangement = Arrangement.spacedBy(20.dp),
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          error?.let { message ->
            item { Banner(message, Modifier.widthIn(max = ArgusMetrics.maxReadingWidth), tone = Tone.Danger, onDismiss = store::clearError) }
          }
          item(key = "teammates") {
            ListSection(Modifier.widthIn(max = ArgusMetrics.maxReadingWidth)) {
              for (summary in teammates) {
                val teammate = summary.teammate
                PressableRow(
                  "Open ${teammate.name}",
                  onClick = { router.push(Route.Teammate(teammate.id, teammate.name)) },
                  menu = { dismiss ->
                    DropdownMenuItem(
                      { Text("Profile") }, { dismiss(); router.push(Route.TeammateProfile(teammate.id, teammate.name)) },
                      leadingIcon = { Icon(Icon.person, null) },
                    )
                    // Paused stops its duties and surfaces; talking to it directly still works.
                    if (access.hasControl) {
                      DropdownMenuItem(
                        { Text(if (teammate.enabled) "Pause" else "Resume") },
                        { dismiss(); scope.launch { store.setEnabled(teammate.id, !teammate.enabled) } },
                        enabled = access.ready, leadingIcon = { Icon(if (teammate.enabled) Icon.stop else Icon.play, null) },
                      )
                    }
                  },
                ) { TeammateRow(summary) }
              }
            }
          }
        }
      }
    }
  }
}

/** The way into Teammates from the Automations tab: who is on the team, at a glance. */
@Composable
fun TeammatesEntryRow(summaries: List<TeammateSummary>, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    Modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .argusClickable(interaction, label = "Teammates", onClick = onClick)
      .padding(horizontal = 16.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Faces(summaries)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text("Teammates", color = theme.text, style = ArgusTheme.typography.body, maxLines = 1)
      Text(
        entrySubtitle(summaries), color = theme.textSecondary, style = ArgusTheme.typography.footnote,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
    }
    if (summaries.any { it.hasUnreadReport }) {
      Box(Modifier.size(8.dp).background(theme.accent, CircleShape).semantics { contentDescription = "New report" })
    }
    Icon(Icon.chevronRight, null, Modifier.size(18.dp), tint = theme.textMuted)
  }
}

@Composable
private fun Faces(summaries: List<TeammateSummary>) {
  val theme = ArgusTheme.colors
  val shown = summaries.filter { it.teammate.enabled }.take(3)
  if (shown.isEmpty()) {
    Box(Modifier.size(30.dp).background(theme.accent.copy(alpha = 0.15f), CircleShape), contentAlignment = Alignment.Center) {
      Icon(Icon.person, null, Modifier.size(16.dp), tint = theme.accent)
    }
    return
  }
  Row(horizontalArrangement = Arrangement.spacedBy((-10).dp)) {
    for (summary in shown) {
      val teammate = summary.teammate
      TeammateAvatar(
        teammate.name, teammate.color, teammate.avatar,
        Modifier.border(2.dp, theme.bgSecondary, CircleShape).background(theme.bgSecondary, CircleShape),
        size = 30.dp,
      )
    }
  }
}

private fun entrySubtitle(summaries: List<TeammateSummary>): String {
  if (summaries.isEmpty()) return "Named agents with their own memory and duties"
  val paused = summaries.count { !it.teammate.enabled }
  val count = if (summaries.size == 1) "1 teammate" else "${summaries.size} teammates"
  return if (paused == 0) count else "$count · $paused paused"
}
