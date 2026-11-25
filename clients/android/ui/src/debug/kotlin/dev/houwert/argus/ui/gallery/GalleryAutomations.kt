package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.houwert.argus.core.automations.ReportBlockView
import dev.houwert.argus.core.automations.newAutomationDetail
import dev.houwert.argus.kit.protocol.generated.AutomationCalibration
import dev.houwert.argus.kit.protocol.generated.AutomationCalibrationDismissalsItem
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationAutonomy
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemory
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemoryType
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteSignalEventKind
import dev.houwert.argus.kit.protocol.generated.RemoteSignalTrigger
import dev.houwert.argus.kit.protocol.generated.RemoteSignalTriggerFire
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTrigger
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTriggerFire
import dev.houwert.argus.kit.protocol.generated.SlackChannelRef
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccountAccountType
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteRunnerModel
import dev.houwert.argus.kit.protocol.generated.RemoteSignalSource
import dev.houwert.argus.kit.protocol.generated.RemoteSignalSourceMode
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.automations.AutomationFields
import dev.houwert.argus.ui.automations.AutomationFieldsContext
import dev.houwert.argus.ui.automations.AutomationRow
import dev.houwert.argus.ui.automations.CalibrationStats
import dev.houwert.argus.ui.automations.FormSheetBody
import dev.houwert.argus.ui.automations.MemoryFields
import dev.houwert.argus.ui.automations.ReportBlocksView
import dev.houwert.argus.ui.automations.ReportMarkdown
import dev.houwert.argus.ui.automations.RunFeedbackFields
import dev.houwert.argus.ui.automations.RunFigures
import dev.houwert.argus.ui.automations.RunStartFields
import dev.houwert.argus.ui.automations.RunRow
import dev.houwert.argus.ui.automations.rememberFeedbackState
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.RunStatusBadge
import kotlinx.serialization.json.JsonArray

private val now = System.currentTimeMillis().toDouble()
private const val MINUTE = 60_000.0
private const val HOUR = 60 * MINUTE

private fun automation(
  id: String,
  name: String,
  cron: String? = "0 9 * * 1-5",
  kind: RemoteAutomationTriggerKind = RemoteAutomationTriggerKind.schedule,
  enabled: Boolean = true,
  running: Boolean = false,
  nextIn: Double? = 3 * HOUR,
  runAt: String? = null,
  slackChannel: SlackChannelRef? = null,
) = RemoteAutomation(
  id = id, name = name, description = "", enabled = enabled, triggerKind = kind, slackChannel = slackChannel, cron = cron, runAt = runAt,
  timezone = "Europe/Amsterdam", autonomy = RemoteAutomationAutonomy.propose, projects = listOf("argus"),
  nextRunAt = nextIn?.let { now + it }, running = running,
)

internal val galleryAutomations = listOf(
  automation("a1", "Stale pull requests"),
  automation("a2", "Nightly dependency audit", cron = "0 2 * * *", nextIn = 9 * HOUR),
  automation("a3", "Flaky test hunter", running = true),
  automation("a4", "Triage new Linear issues", cron = "*/30 * * * *", nextIn = 12 * MINUTE),
  automation("a5", "Weekly changelog draft", cron = "0 16 * * 5", nextIn = 50 * HOUR),
  automation("a6", "Release notes check", kind = RemoteAutomationTriggerKind.manual, cron = null, nextIn = null),
  automation("a7", "Accessibility sweep", enabled = false),
  automation("a8", "Bundle size watch", cron = "0 */6 * * *", nextIn = 2 * HOUR),
  automation("a9", "Onboarding copy review", kind = RemoteAutomationTriggerKind.once, cron = null, runAt = "2026-12-01T09:00"),
  automation(
    "a10", "Deploy failure triage", kind = RemoteAutomationTriggerKind.slack, cron = null, nextIn = null,
    slackChannel = SlackChannelRef("C1", "deploys"),
  ),
  automation("a11", "Docs link checker", enabled = false, cron = "0 3 * * 0"),
  automation("a12", "Unused feature flags", cron = "0 10 1 * *", nextIn = 300 * HOUR),
  automation("a13", "Fix my red CI", kind = RemoteAutomationTriggerKind.signal, cron = null, nextIn = null),
  automation("a14", "Review deploy previews", kind = RemoteAutomationTriggerKind.webhook, cron = null, nextIn = null),
)

private val signalDraft = newAutomationDetail(
  name = "Fix my red CI", triggerKind = RemoteAutomationTriggerKind.signal, cron = null,
  playbook = "# Fix my red CI\n\nRead the failing job's log, fix the cause on the PR's branch and push.",
).copy(
  id = "a13",
  signal = RemoteSignalTrigger(
    on = listOf(RemoteSignalEventKind.ciFailed), labels = emptyList(), fire = RemoteSignalTriggerFire.each, maxRunsPerHour = 4.0,
  ),
)

private val webhookDraft = newAutomationDetail(
  name = "Review deploy previews", triggerKind = RemoteAutomationTriggerKind.webhook, cron = null,
  playbook = "# Review deploy previews\n\nOpen the preview URL from the payload and check the changed pages.",
).copy(
  id = "a14",
  webhook = RemoteWebhookTrigger(
    fire = RemoteWebhookTriggerFire.batch, maxRunsPerHour = 6.0,
    url = "https://argus-7f3a.houwert.dev/hooks/automations/a14", hasSecret = true,
  ),
)

private fun run(
  id: String,
  name: String,
  status: RemoteAutomationRunStatus,
  ago: Double,
  took: Double? = 4 * MINUTE,
  cost: Double? = 0.42,
  error: String? = null,
  preview: String? = null,
  unread: Boolean = false,
  quick: Boolean = false,
) = RemoteAutomationRun(
  id = id, automationId = "a-$name", automationName = name, isQuick = quick, status = status, triggerReason = if (quick) "Quick run" else "Scheduled",
  startedAt = now - ago, finishedAt = took?.let { now - ago + it }, costUsd = cost, error = error, unreadReport = unread, reportPreview = preview,
  hostSessionId = "s-$id", hostAgentId = "ag-$id",
)

internal val galleryRuns = listOf(
  run("r1", "Flaky test hunter", RemoteAutomationRunStatus.running, 2 * MINUTE, took = null, cost = null),
  run("r2", "Stale pull requests", RemoteAutomationRunStatus.succeeded, 3 * HOUR, preview = "3 pull requests have had no review for a week.", unread = true),
  run("r3", "Nightly dependency audit", RemoteAutomationRunStatus.failed, 9 * HOUR, error = "pnpm audit exited with code 1: registry unreachable"),
  run("r4", "Triage new Linear issues", RemoteAutomationRunStatus.skipped, 30 * MINUTE, took = 1000.0, cost = 0.0, preview = "Nothing new since the last run."),
  run("r5", "Rename the settings keys", RemoteAutomationRunStatus.cancelled, 26 * HOUR, quick = true),
  run(
    "r6", "Stale pull requests", RemoteAutomationRunStatus.skipped, 2 * HOUR, took = 2000.0, cost = null,
    error = "Skipped — the precheck exited with code 1.\nNo pull requests idle for a week.",
  ),
)

private val calibration = AutomationCalibration(
  automationId = "a1", sample = 14.0, accepted = 6.0, autoStarted = 2.0, dismissed = 5.0, pending = 1.0, resolved = 0.0,
  superseded = 0.0, withdrawn = 0.0, merged = 5.0, abandoned = 1.0, reverted = 0.0, acceptanceRate = 0.57,
  dismissals = listOf(AutomationCalibrationDismissalsItem("Bump eslint to 10", "Blocked on the flat config migration")),
  acceptedNotes = emptyList(),
)

private val reportJson = """
[
  {"type":"heading","text":"Stale pull requests"},
  {"type":"markdown","text":"Three pull requests have waited **over a week** for review. The oldest touches `session/merge.ts`."},
  {"type":"stats","items":[{"label":"Open","value":"11","delta":2},{"label":"Stale","value":"3","delta":-1},{"label":"Median age","value":"2.5d"}]},
  {"type":"list","items":[{"text":"Unify the start composer (9 days)","tone":"warning"},{"text":"Fix the worktree cleanup race","tone":"critical"},{"text":"Docs: routing inventory","tone":"positive"}]},
  {"type":"table","columns":["Pull request","Age","Reviewers"],"rows":[["#412","9d",0],["#418","8d",1],["#421","7d",0]]},
  {"type":"series","kind":"bar","labels":["Mon","Tue","Wed","Thu","Fri"],"values":[2,5,3,7,4],"label":"Reviews per day"},
  {"type":"sessions","ids":["s1","s2"]}
]
"""

private val memory = RemoteAutomationMemory(
  name = "session-merge-flow", description = "Where session merges are implemented", type = RemoteAutomationMemoryType.project,
  body = "Merges run in `packages/host/src/services/session/merge.ts`.\n\n- Squash by default\n- Rebase when the base moved", updatedAt = now,
)

private val fieldsContext = AutomationFieldsContext(
  sources = listOf(
    RemoteSignalSource("github", "GitHub pull requests", RemoteSignalSourceMode.native, true),
    RemoteSignalSource("linear", "Linear issues", RemoteSignalSourceMode.native, false),
  ),
  runners = listOf(
    RemoteRunner("claude-code", "Claude Code", isCustom = false, models = emptyList()),
    RemoteRunner("codex", "Codex", isCustom = false, models = listOf(RemoteRunnerModel("gpt-5", "GPT-5")), available = false),
  ),
  projects = listOf(RemoteProject("/Users/me/Work/argus", "argus"), RemoteProject("/Users/me/Work/peacock", "peacock")),
  accounts = listOf(
    RemoteClaudeAccount("w", label = "Work", needsReauth = false, rateLimited = false, accountType = RemoteClaudeAccountAccountType.claudeai),
    RemoteClaudeAccount("h", label = "Home", needsReauth = false, rateLimited = false, accountType = RemoteClaudeAccountAccountType.claudeai),
  ),
  activeAccountId = "w",
  hasControl = true,
)

@Composable
internal fun AutomationsGalleryPage() {
  Story("Automation rows") {
    ListSection {
      for ((i, a) in galleryAutomations.withIndex()) {
        val last = galleryRuns.getOrNull(i % 4)
        AutomationRow(a, lastRun = last?.status, lastRunAt = last?.startedAt, onClick = {})
      }
    }
  }
  Story("Run rows") {
    ListSection(header = "Recent runs") {
      for (r in galleryRuns) RunRow(r, onClick = {}, showName = true)
    }
    ListSection(header = "Run history") {
      for (r in galleryRuns.take(3)) RunRow(r, onClick = {})
    }
  }
  Story("Status badges") {
    Column { for (s in RemoteAutomationRunStatus.entries) RunStatusBadge(s) }
  }
  Story("Run figures") {
    val r = galleryRuns[1]
    Card { RunFigures(listOf("Started" to Labels.timeAgo(r.startedAt), "Duration" to Labels.runDuration(r), "Cost" to Labels.runCost(r))) }
  }
  Story("Track record") { Card { CalibrationStats(calibration) } }
  Story("Report") {
    val blocks = remember { ReportBlockView.parseAll(ProtocolJson.json.parseToJsonElement(reportJson) as JsonArray) }
    Card { ReportBlocksView(blocks) { ids -> MutedText("${ids.size} proposal cards") } }
  }
  Story("Markdown") {
    Card { ReportMarkdown("## Findings\n\nThe *flaky* test is `merge.spec.ts`. See [the run](https://example.com).\n\n1. Retry once\n2. Quarantine\n\n> It failed every morning.") }
  }
  Story("Memory fields") {
    var draft by remember { mutableStateOf(memory) }
    MemoryFields(draft) { draft = it }
  }
  Story("Feedback sheet") {
    Card { FormSheetBody("Give Feedback", onDismiss = {}, confirmLabel = "Send", confirmEnabled = false) { RunFeedbackFields(rememberFeedbackState(), null, autofocus = false) } }
  }
  Story("Automation fields") {
    var draft by remember { mutableStateOf(newAutomationDetail(name = "Stale pull requests", playbook = "# Stale pull requests\n\nList open PRs with no review for 7 days.", claudeAccountId = "h")) }
    AutomationFields(draft, { draft = it }, fieldsContext, revise = { "$it\n\n(rewritten)" })
  }
  Story("Precheck fields") {
    var draft by remember {
      mutableStateOf(
        newAutomationDetail(name = "Stale pull requests", playbook = "# Stale pull requests", precheckCommand = "./scripts/has-stale-prs.sh")
          .copy(precheckTimeoutSeconds = 30.0),
      )
    }
    RunStartFields(draft) { draft = it }
  }
  Story("Signal trigger fields") {
    var draft by remember { mutableStateOf(signalDraft) }
    AutomationFields(draft, { draft = it }, fieldsContext)
  }
  Story("Webhook trigger fields") {
    var draft by remember { mutableStateOf(webhookDraft) }
    AutomationFields(
      draft, { draft = it },
      fieldsContext.copy(rotateWebhook = { MethodsTypes.AutomationsRotateWebhookResult(webhookDraft.webhook?.url, "whsec_4f9c1e7b2a8d") }),
    )
  }
  Story("Quick run fields") {
    var draft by remember { mutableStateOf(newAutomationDetail(name = "Rename the settings keys")) }
    AutomationFields(draft, { draft = it }, fieldsContext, showsSchedule = false)
  }
  InboxGalleryStories()
}
