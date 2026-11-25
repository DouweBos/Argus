package dev.houwert.argus.app.screens.automations

import dev.houwert.argus.core.automations.conversationNote
import dev.houwert.argus.core.automations.isSkipped
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.automations.ReportBlockView
import dev.houwert.argus.core.automations.isActive
import dev.houwert.argus.core.stores.adoptSession
import dev.houwert.argus.core.stores.deleteRunOverGateway
import dev.houwert.argus.core.stores.openAgent
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.automations.AutomationText
import dev.houwert.argus.ui.automations.ConfirmDialog
import dev.houwert.argus.ui.automations.ReportBlocksView
import dev.houwert.argus.ui.automations.ReportMarkdown
import dev.houwert.argus.ui.automations.RunFeedbackSheet
import dev.houwert.argus.ui.automations.RunFigures
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.label
import dev.houwert.argus.ui.components.tone
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * One firing: how it went, what it cost, and the report it wrote. A run is an ordinary
 * session with an ordinary agent, so the transcript is one tap away for when the report
 * doesn't answer the question.
 */
@Composable
fun RunScreen(id: String, label: String) {
  val store = LocalAppStore.current.automations
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val detailByRun by store.detailByRun.collectAsState()
  val runs by store.runs.collectAsState()
  val error by store.error.collectAsState()
  val detail = detailByRun[id]
  val run = detail?.run ?: runs.firstOrNull { it.id == id }
  var givingFeedback by remember { mutableStateOf(false) }
  var confirmingDelete by remember { mutableStateOf(false) }
  // The name being typed while promoting a quick run; null when not saving.
  var savingName by remember { mutableStateOf<String?>(null) }

  LaunchedEffect(id) {
    store.loadRun(id)
    // Opening a report clears its unread dot on the computer too.
    store.markRunRead(id)
  }
  // A settled run's report never changes, so stop asking.
  LiveRefresh(enabled = access.ready && (run?.isActive ?: true)) { store.loadRun(id) }

  AutomationsScaffold(
    label,
    actions = {
      if (access.hasControl && run != null && !run.isActive) {
        IconButton({ confirmingDelete = true }) { Icon(Icon.trash, "Delete run") }
      }
    },
  ) {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = store::clearError) }
      if (run == null) {
        Loading("Reading the run")
      } else {
        Summary(run, access, onFeedback = { givingFeedback = true }, onSave = { savingName = run.automationName })
        Report(run, detail)
        FeedbackLog(detail)
      }
    }
  }

  if (givingFeedback) {
    RunFeedbackSheet(error, send = { note, allowClearing -> store.sendRunFeedback(id, note, allowClearing) }, onDismiss = { givingFeedback = false })
  }
  if (confirmingDelete) {
    ConfirmDialog(
      "Delete this run?", "Its record, its report and the proposals it raised go for good.", "Delete",
      onConfirm = {
        confirmingDelete = false
        scope.launch { if (store.deleteRunOverGateway(id)) router.pop() }
      },
      onDismiss = { confirmingDelete = false },
    )
  }
  savingName?.let { name ->
    SaveAsAutomationDialog(name, { savingName = it }, onDismiss = { savingName = null }) {
      val trimmed = name.trim()
      savingName = null
      scope.launch { store.saveScratchRun(id, trimmed)?.let { router.push(Route.AutomationEditor(it, trimmed)) } }
    }
  }
}

@Composable
private fun Summary(run: RemoteAutomationRun, access: HostAccess, onFeedback: () -> Unit, onSave: () -> Unit) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  var opening by remember { mutableStateOf(false) }
  Card {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Badge(run.status.label, tone = run.status.tone)
      if (run.isQuick) Badge("Quick")
    }
    MutedText(run.triggerReason)
    run.conversationNote?.let { MutedText(it) }
    RunFigures(listOf("Started" to Labels.timeAgo(run.startedAt), "Duration" to Labels.runDuration(run), "Cost" to Labels.runCost(run)))
    run.error?.takeIf { it.isNotEmpty() }?.let { Banner(it, tone = if (run.isSkipped) Tone.Warning else Tone.Danger) }

    FlowRow(Modifier.fillMaxWidth(), spacing = 8.dp) {
      run.hostAgentId?.let { agentId ->
        Btn(if (opening) "Opening" else "Open agent", tone = ButtonTone.Secondary, small = true, icon = Icon.agent, busy = opening) {
          // A stopped run's agent is resumed from its saved chat (control only), so the button lands on a live agent.
          val sessionId = run.hostSessionId
          if (!access.hasControl || sessionId == null) {
            router.push(Route.Agent(agentId, run.automationName))
            return@Btn
          }
          opening = true
          scope.launch {
            if (app.host.session(sessionId) == null) app.host.adoptSession(sessionId)
            val opened = app.host.session(sessionId)?.let { app.host.openAgent(agentId, it)?.agentId }
            opening = false
            router.push(Route.Agent(opened ?: agentId, run.automationName))
          }
        }
      }
      if (access.hasControl && run.isActive) {
        Btn("Cancel", tone = ButtonTone.Danger, small = true) { scope.launch { app.automations.cancelRun(run.id) } }
      }
      // Nothing to resume once the run's session is gone.
      if (access.hasControl && !run.isActive && run.hostSessionId != null) {
        Btn("Give feedback", tone = ButtonTone.Secondary, small = true, icon = Icon.chat, onClick = onFeedback)
      }
      // A one-off that turned out to be worth keeping.
      if (access.hasControl && run.isQuick && !run.isActive) {
        Btn("Save as automation", tone = ButtonTone.Secondary, small = true, onClick = onSave)
      }
    }
  }
}

@Composable
private fun Report(run: RemoteAutomationRun, detail: MethodsTypes.AutomationsRunResult?) {
  if (detail == null && !run.isActive) return
  val blocks = remember(detail?.reportBlocks) { detail?.reportBlocks?.let(ReportBlockView::parseAll).orEmpty() }
  val markdown = detail?.reportMarkdown
  Card {
    SectionHeader("Report")
    when {
      blocks.isNotEmpty() -> ReportBlocksView(blocks) { ids -> RunProposals(ids) }
      !markdown.isNullOrEmpty() -> ReportMarkdown(markdown)
      run.isActive ->
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          CircularProgressIndicator(Modifier.size(14.dp), color = ArgusTheme.colors.textMuted, strokeWidth = 2.dp)
          MutedText("The report appears when the run finishes.")
        }
      else -> MutedText("This run wrote no report.")
    }
  }
}

/** The proposals a run raised, each opening its own screen; ones since cleared from the computer are counted. */
@Composable
private fun RunProposals(ids: List<String>) {
  val proposals = LocalAppStore.current.proposals
  val router = LocalRouter.current
  var looked by remember(ids) { mutableStateOf(false) }
  LaunchedEffect(ids) {
    for (id in ids) if (proposals.cached(id) == null) proposals.load(id)
    looked = true
  }
  // Re-read after each load: the cache isn't observable on its own.
  val found = remember(ids, looked) { ids.mapNotNull(proposals::cached) }
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (found.isNotEmpty()) {
      ListSection {
        for (p in found) ListRow(p.title, subtitle = p.summary, icon = Icon.proposal, onClick = { router.push(Route.Proposal(p.id)) })
      }
    }
    val missing = ids.size - found.size
    when {
      missing > 0 && looked ->
        MutedText("${AutomationText.plural(missing, "proposal")} from this run ${if (missing == 1) "is" else "are"} no longer on the computer.")
      missing > 0 -> CircularProgressIndicator(Modifier.size(14.dp), color = ArgusTheme.colors.textMuted, strokeWidth = 2.dp)
    }
  }
}

/** What was argued with, in the user's own words: a corrected report that doesn't say why reads like it changed its mind. */
@Composable
private fun FeedbackLog(detail: MethodsTypes.AutomationsRunResult?) {
  val notes = detail?.feedback.orEmpty()
  if (notes.isEmpty()) return
  Card {
    SectionHeader("Feedback", count = notes.size)
    for (entry in notes) {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          MonoText(Labels.timeAgo(entry.createdAt), size = 11, color = ArgusTheme.colors.textMuted)
          if (entry.allowClearing) Badge("could remove proposals", tone = Tone.Warning)
        }
        ReportMarkdown(entry.note)
      }
    }
  }
}

@Composable
private fun SaveAsAutomationDialog(name: String, onName: (String) -> Unit, onDismiss: () -> Unit, onSave: () -> Unit) {
  val theme = ArgusTheme.colors
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("Save as automation") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Keeps the playbook and scope. It's saved paused, with no schedule.")
        ThemedTextField(name, onName, "Name", input = TextInput.Name)
      }
    },
    confirmButton = { TextButton(onSave, enabled = name.isNotBlank()) { Text("Save") } },
    dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
    containerColor = theme.surface,
    titleContentColor = theme.text,
    textContentColor = theme.textSecondary,
  )
}
