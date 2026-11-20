package dev.houwert.argus.app.screens.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.automations.summary
import dev.houwert.argus.core.routing.InboxFilter
import dev.houwert.argus.core.stores.InboxFilterField
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.inbox.ClearedProposalRow
import dev.houwert.argus.ui.inbox.InboxFilterMenu
import dev.houwert.argus.ui.inbox.ProposalCard
import dev.houwert.argus.ui.inbox.ProposalCardActions
import dev.houwert.argus.ui.inbox.ProposalCardContent
import dev.houwert.argus.ui.inbox.StartedProposalCard
import dev.houwert.argus.ui.inbox.StartedProposalRow
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * What the computer's automations want from you, in the Mac's groups: a decision outranks a
 * report, which outranks work in flight, which outranks a run that already failed.
 */
@Composable
fun InboxScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val proposals = app.proposals
  val automations = app.automations
  val scope = rememberCoroutineScope()

  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  val sessionsByRepo by host.sessionsByRepo.collectAsState()
  val projects by host.projects.collectAsState()
  val runs by automations.runs.collectAsState()
  val automationList by automations.automations.collectAsState()
  val loaded by proposals.loaded.collectAsState()
  val error by proposals.error.collectAsState()
  val started by proposals.started.collectAsState()
  val busy by proposals.busy.collectAsState()
  val requestErrors by proposals.requestErrors.collectAsState()
  // Read so the cards and groups follow every change the store makes.
  proposals.proposals.collectAsState().value
  proposals.recent.collectAsState().value
  proposals.requesting.collectAsState().value
  proposals.starting.collectAsState().value

  // The route carries no filter, so it's screen state.
  var filter by rememberSaveable(stateSaver = InboxFilterSaver) { mutableStateOf(InboxFilter.all) }
  // The failure and cleared windows are relative to now.
  var now by remember { mutableDoubleStateOf(System.currentTimeMillis().toDouble()) }
  LaunchedEffect(Unit) {
    while (true) {
      delay(60_000)
      now = System.currentTimeMillis().toDouble()
    }
  }

  val all = proposals.items(runs, sessionsByRepo.values.flatten().map { it.id }.toSet(), now)
  val items = all.filtered(filter)
  val options = all.filterOptions(filter) { id ->
    automationList.firstOrNull { it.id == id }?.name
      ?: (all.pending + all.started + all.cleared).firstOrNull { it.automationId == id }?.automationName
      ?: (all.failed + all.reports).firstOrNull { it.automationId == id }?.automationName
  }
  val setFilter = { next: InboxFilter, _: InboxFilterField -> filter = next }

  suspend fun refresh() {
    coroutineScope {
      val listed = async { proposals.refresh() }
      val ran = async { automations.refresh() }
      listed.await()
      ran.await()
    }
    now = System.currentTimeMillis().toDouble()
  }

  LiveRefresh(enabled = connection == Transport.State.Ready) { refresh() }

  TopBarScaffold(
    Route.Inbox, "Inbox", onRefresh = { refresh() },
    actions = { if (!all.isEmpty || !filter.isEmpty) InboxFilterMenu(options, filter, setFilter) },
  ) {
    LoadPhaseBox(
      loaded, error, isEmpty = items.isEmpty && started.isEmpty(), Modifier.fillMaxSize(),
      loadingLabel = "Reading the inbox", failedTitle = "Inbox unavailable", onRetry = { scope.launch { refresh() } },
      empty = {
        if (filter.isEmpty) {
          EmptyState(Icon.inbox, "Nothing needs you", body = "Your automations have nothing waiting on you. This is what a quiet inbox looks like.")
        } else {
          EmptyState(Icon.inbox, "Nothing here", body = "Nothing in the inbox matches this filter.") {
            Btn("Clear filters", hugs = true) { setFilter(InboxFilter.all, InboxFilterField.Clear) }
          }
        }
      },
    ) {
      // Started from this phone: the card follows it until opened, so "on it" doesn't list it twice.
      val local = started.map { it.id }.toSet()
      val onIt = items.started.filter { it.id !in local }
      LazyColumn(
        Modifier.fillMaxSize().background(ArgusTheme.colors.bg),
        contentPadding = PaddingValues(ArgusMetrics.space),
        verticalArrangement = Arrangement.spacedBy(ArgusMetrics.space),
      ) {
        if (!filter.isEmpty) {
          // The top bar shows the filter as an icon only; say what's hidden here.
          item(key = "filter") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
              Text(
                "Showing ${options.summary(filter)}", Modifier.weight(1f), color = ArgusTheme.colors.textSecondary,
                style = ArgusTheme.typography.footnote, maxLines = 1,
              )
              AccentLink("Clear", size = 13) { setFilter(InboxFilter.all, InboxFilterField.Clear) }
            }
          }
        }
        error?.let { message -> item(key = "error") { Banner(message, tone = Tone.Danger, onDismiss = proposals::clearError) } }
        if (items.pending.isNotEmpty() || started.isNotEmpty()) {
          item(key = "decide") {
            SectionHeader(if (items.pending.isEmpty()) "Decide" else "Decide · ${items.pending.size} waiting")
          }
          items(started, key = { "started:${it.id}" }) { proposal ->
            StartedProposalCard(
              proposal,
              onOpen = {
                proposal.agentId?.let { agentId ->
                  proposals.closeStarted(proposal.id)
                  router.push(Route.Agent(agentId, proposal.title))
                }
              },
              onClose = { proposals.closeStarted(proposal.id) },
            )
          }
          items(items.pending, key = { it.id }) { proposal ->
            ProposalCard(
              ProposalCardContent.from(proposal, projects.firstOrNull { it.name == proposal.project }?.repoRoot),
              busy = proposal.id in busy,
              starting = proposals.isStarting(proposal),
              canDecide = hasControl,
              requestError = requestErrors[proposal.id],
              actions = ProposalCardActions(
                start = { note ->
                  // Go and watch the agent when it came up inside the request; a slower start shows on the card.
                  scope.launch { proposals.accept(proposal.id, note)?.let { router.push(Route.Agent(it, proposal.title)) } }
                },
                requestRevision = { note -> scope.launch { proposals.requestRevision(proposal.id, note) } },
                resolve = { note -> scope.launch { proposals.resolve(proposal.id, note) } },
                dismiss = { reason -> scope.launch { proposals.dismiss(proposal.id, reason) } },
                cleanup = { scope.launch { proposals.performCleanup(proposal.id) } },
                openRun = proposal.runId?.let { runId -> { router.push(Route.Run(runId, proposal.automationName)) } },
                openDetails = { router.push(Route.Proposal(proposal.id)) },
              ),
            )
          }
        }
        if (items.reports.isNotEmpty()) {
          item(key = "reports") {
            ListSection(header = "New reports · ${items.reports.size}") {
              items.reports.forEach { run -> InboxRunRow(run, Tone.Accent, now) { router.push(Route.Run(run.id, run.automationName)) } }
            }
          }
        }
        if (onIt.isNotEmpty()) {
          item(key = "started") {
            ListSection(header = "Argus is on it · ${onIt.size}") {
              onIt.forEach { proposal ->
                StartedProposalRow(proposal, onClick = {
                  router.push(proposal.agentId?.let { Route.Agent(it, proposal.title) } ?: Route.Proposal(proposal.id))
                })
              }
            }
          }
        }
        if (items.failed.isNotEmpty()) {
          item(key = "failed") {
            ListSection(header = "Needs a look · ${items.failed.size}") {
              items.failed.forEach { run ->
                // A failure teaches nothing, so dismissing it asks for no reason.
                val dismiss = if (hasControl) ({ scope.launch { automations.dismissRun(run.id) }; Unit }) else null
                DismissibleRow(run.id, dismiss) {
                  InboxRunRow(run, Tone.Danger, now) { router.push(Route.Run(run.id, run.automationName)) }
                }
              }
            }
          }
        }
        if (items.cleared.isNotEmpty()) {
          item(key = "cleared") {
            ListSection(header = "Argus cleared these · ${items.cleared.size}") {
              items.cleared.forEach { proposal -> ClearedProposalRow(proposal, { router.push(Route.Proposal(proposal.id)) }, nowMillis = now) }
            }
          }
        }
      }
    }
  }
}

/** A report to read or a failure to look at. Stands in until the automations group's shared run row lands. */
@Composable
private fun InboxRunRow(run: RemoteAutomationRun, tone: Tone, now: Double, onClick: () -> Unit) {
  ListRow(
    run.automationName, subtitle = run.error ?: run.summary,
    icon = if (tone == Tone.Danger) Icon.warning else Icon.file,
    iconTint = if (tone == Tone.Danger) ArgusTheme.colors.error else ArgusTheme.colors.textSecondary,
    onClick = onClick,
    trailing = { Badge(Labels.timeAgo(run.startedAt, now), tone = tone) },
  )
}

/** Swipe from the end to dismiss, with the same action for TalkBack; [onDismiss] null leaves the row still. */
@Composable
private fun DismissibleRow(key: String, onDismiss: (() -> Unit)?, content: @Composable () -> Unit) {
  if (onDismiss == null) return content()
  val state = rememberSwipeToDismissBoxState(
    confirmValueChange = {
      if (it == SwipeToDismissBoxValue.EndToStart) onDismiss()
      it == SwipeToDismissBoxValue.EndToStart
    },
  )
  SwipeToDismissBox(
    state,
    modifier = Modifier.semantics {
      customActions = listOf(CustomAccessibilityAction("Dismiss") { onDismiss(); true })
    },
    enableDismissFromStartToEnd = false,
    backgroundContent = {
      Box(Modifier.fillMaxSize().background(ArgusTheme.colors.errorSoft).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterEnd) {
        Text("Dismiss", color = ArgusTheme.colors.error, style = ArgusTheme.typography.subheadline)
      }
    },
  ) {
    Box(Modifier.background(ArgusTheme.colors.bgSecondary)) { content() }
  }
}

private val InboxFilterSaver = Saver<InboxFilter, List<String>>(
  save = { listOf(it.automationId.orEmpty(), it.project.orEmpty()) },
  restore = { InboxFilter(it[0].ifEmpty { null }, it[1].ifEmpty { null }) },
)

