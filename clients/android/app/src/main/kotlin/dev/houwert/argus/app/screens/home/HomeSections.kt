package dev.houwert.argus.app.screens.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.AppSection
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.core.stores.hasUnreadReport
import dev.houwert.argus.core.usage.UsageLimitFormat
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageLimits
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.RunStatusBadge
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.label
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.components.tone
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import dev.houwert.argus.ui.usage.UsageLimitsStrip
import kotlinx.coroutines.launch

/** Follows a Home link, counting which kind. */
fun followHomeLink(action: TelemetryEvent.HomeAction, go: () -> Unit) {
  Telemetry.capture(TelemetryEvent.HomeUsed(action))
  go()
}

/** What's left of each plan window, shown only once the host reports some; the link opens Usage. */
fun LazyListScope.planLimitsSection(limits: ClaudeUsageLimits?, onUsage: () -> Unit) {
  if (UsageLimitFormat.groups(limits).isEmpty()) return
  item("limits-header") { HomeSectionHeader("Plan limits", action = "View usage" to { followHomeLink(TelemetryEvent.HomeAction.Usage, onUsage) }) }
  item("limits") { UsageLimitsStrip(limits, Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
}

/** A section header with an optional count and a trailing link, as the Mac's `HomeSection` draws them. */
@Composable
fun HomeSectionHeader(title: String, note: String? = null, action: Pair<String, () -> Unit>? = null) {
  val theme = ArgusTheme.colors
  Row(
    Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 20.dp, bottom = 4.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(title, Modifier.semantics { heading() }, color = theme.textMuted, style = argusFont(13, FontWeight.SemiBold))
    if (note != null) Text(note, color = theme.warning, style = argusFont(13, FontWeight.SemiBold))
    Box(Modifier.weight(1f))
    if (action != null) {
      Text(
        action.first,
        Modifier.argusClickable(rememberInteraction(), label = action.first, onClick = action.second).padding(horizontal = 12.dp, vertical = 8.dp),
        color = theme.accent, style = ArgusTheme.typography.footnote,
      )
    }
  }
}

/** A plain list row's frame: padded, tappable, divided from the next. */
@Composable
fun HomeRow(label: String, modifier: Modifier = Modifier, onClick: () -> Unit, content: @Composable () -> Unit) {
  Box(Modifier.fillMaxWidth().argusClickable(rememberInteraction(), label = label, onClick = onClick).then(modifier).padding(horizontal = 16.dp, vertical = 10.dp)) {
    content()
  }
}

/** Which computer this is, labelled, and the way to another. */
@Composable
fun ComputerSwitcher() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val theme = ArgusTheme.colors
  val identity by app.identity.collectAsState()
  val hosts by app.pairedHosts.collectAsState()
  val active by app.activeHostId.collectAsState()
  val connection by app.host.connection.collectAsState()
  val scope = rememberCoroutineScope()
  var open by remember { mutableStateOf(false) }
  val name = identity?.label ?: "No computer"
  Box {
    Row(
      Modifier.fillMaxWidth().argusClickable(rememberInteraction(), label = "Computer, $name, ${connection.label}") { open = true }
        .padding(horizontal = 16.dp, vertical = 12.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(Icon.desktop, null, Modifier.size(22.dp), tint = theme.accent)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          Text("Computer", color = theme.textSecondary, style = ArgusTheme.typography.caption)
          StatusDot(connection.tone, pulse = connection != dev.houwert.argus.kit.net.Transport.State.Ready)
          Text(connection.label, color = theme.textSecondary, style = ArgusTheme.typography.caption)
        }
        Text(name, color = theme.text, style = argusFont(16, FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
      Icon(Icon.chevronUpDown, null, Modifier.size(14.dp), tint = theme.textMuted)
    }
    DropdownMenu(open, { open = false }) {
      hosts.forEach { host ->
        DropdownMenuItem(
          { Text(host.label) },
          { open = false; scope.launch { app.selectHost(host.deviceId) } },
          leadingIcon = { RadioButton(host.deviceId == active, null) },
        )
      }
      HorizontalDivider()
      DropdownMenuItem({ Text("Pair a computer") }, { open = false; router.push(Route.Pair) }, leadingIcon = { Icon(Icon.plus, null) })
      DropdownMenuItem({ Text("Manage computers") }, { open = false; router.push(Route.Computers) }, leadingIcon = { Icon(Icon.desktop, null) })
    }
  }
}

/** What Argus is waiting on you for: the inbox's actionable half, as the Mac's home leads with it. */
fun LazyListScope.needsYouSection(needs: dev.houwert.argus.core.stores.InboxItems.NeedsYou, onInbox: () -> Unit, push: (Route) -> Unit) {
  if (needs.waiting <= 0) return
  item("needs-header") { HomeSectionHeader("Needs you", note = "${needs.waiting} waiting") }
  items(needs.proposals, key = { "proposal:${it.id}" }) { proposal ->
    HomeRow(proposal.title, onClick = { push(Route.Proposal(proposal.id)) }) {
      NeedsRow(Icon.proposal, ArgusTheme.colors.accent, proposal.title, proposal.summary)
    }
  }
  items(needs.failed, key = { "failed:${it.id}" }) { run ->
    HomeRow(run.automationName, onClick = { push(Route.Run(run.id, run.automationName)) }) {
      NeedsRow(Icon.warning, ArgusTheme.colors.error, run.automationName, run.error ?: run.triggerReason)
    }
  }
  if (needs.hidden > 0) {
    item("needs-more") {
      HomeRow("${needs.hidden} more in the inbox", onClick = onInbox) {
        Text("${needs.hidden} more in the inbox", color = ArgusTheme.colors.accent, style = ArgusTheme.typography.body)
      }
    }
  }
}

@Composable
private fun NeedsRow(icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, title: String, detail: String) {
  val theme = ArgusTheme.colors
  Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, null, Modifier.width(20.dp), tint = tint)
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(title, color = theme.text, style = argusFont(17, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(detail, color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
  }
}

/** The newest automation runs, unread reports first: they happen while nobody is looking. */
fun LazyListScope.recentRunsSection(runs: List<dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun>, onAll: () -> Unit, push: (Route) -> Unit) {
  if (runs.isEmpty()) return
  val sorted = runs.sortedWith(compareByDescending<dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun> { it.hasUnreadReport }.thenByDescending { it.startedAt })
  val unread = sorted.count { it.hasUnreadReport }
  item("runs-header") {
    HomeSectionHeader("Recent runs", note = if (unread > 0) "$unread new report${if (unread == 1) "" else "s"}" else null, action = "View all" to onAll)
  }
  items(sorted.take(5), key = { "run:${it.id}" }) { run ->
    val name = if (run.isQuick) "Quick run" else run.automationName
    val theme = ArgusTheme.colors
    HomeRow(name, onClick = { push(Route.Run(run.id, name)) }) {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp)) { if (run.hasUnreadReport) StatusDot(dev.houwert.argus.ui.theme.Tone.Accent) }
        RunStatusBadge(run.status)
        Text(name, Modifier.weight(1f), color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(Labels.timeAgo(run.startedAt), color = theme.textMuted, style = ArgusTheme.typography.caption)
      }
    }
  }
}

/** Shared with the project screen, so a project's fold is the same everywhere. */
object ProjectFolds {
  val collapsed = kotlinx.coroutines.flow.MutableStateFlow(emptySet<String>())
  val unfolded = kotlinx.coroutines.flow.MutableStateFlow(emptySet<String>())

  fun toggle(set: kotlinx.coroutines.flow.MutableStateFlow<Set<String>>, key: String) {
    set.value = if (key in set.value) set.value - key else set.value + key
  }
}

