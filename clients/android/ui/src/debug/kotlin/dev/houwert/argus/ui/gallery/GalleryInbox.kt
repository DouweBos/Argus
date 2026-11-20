package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.compare.CompareGroup
import dev.houwert.argus.core.compare.CompareLanding
import dev.houwert.argus.core.routing.InboxFilter
import dev.houwert.argus.core.stores.InboxItems
import dev.houwert.argus.kit.protocol.generated.Blueprint
import dev.houwert.argus.kit.protocol.generated.BlueprintAgent
import dev.houwert.argus.kit.protocol.generated.BlueprintGithub
import dev.houwert.argus.kit.protocol.generated.BlueprintReference
import dev.houwert.argus.kit.protocol.generated.BlueprintRun
import dev.houwert.argus.kit.protocol.generated.BlueprintRunStatus
import dev.houwert.argus.kit.protocol.generated.BlueprintScaffold
import dev.houwert.argus.kit.protocol.generated.BlueprintScaffoldEmpty
import dev.houwert.argus.kit.protocol.generated.BlueprintScaffoldGithubTemplate
import dev.houwert.argus.kit.protocol.generated.BlueprintVisibility
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.protocol.generated.RemoteCompareRun
import dev.houwert.argus.kit.protocol.generated.RemoteCompareRunState
import dev.houwert.argus.kit.protocol.generated.RemoteCompareSlot
import dev.houwert.argus.kit.protocol.generated.RemoteCompareSlotAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteCompareSlotDiff
import dev.houwert.argus.kit.protocol.generated.RemoteProposal
import dev.houwert.argus.kit.protocol.generated.RemoteProposalCta
import dev.houwert.argus.kit.protocol.generated.RemoteProposalCtaKind
import dev.houwert.argus.kit.protocol.generated.RemoteProposalStartStage
import dev.houwert.argus.kit.protocol.generated.RemoteProposalStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.SessionCompareGroup
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupEntry
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupGuard
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupPolicy
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupPreview
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupReason
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupSweep
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupSweepTrigger
import dev.houwert.argus.ui.blueprints.BlueprintRow
import dev.houwert.argus.ui.blueprints.BlueprintRunRow
import dev.houwert.argus.ui.compare.CompareKeepForm
import dev.houwert.argus.ui.compare.CompareRunHeaderRow
import dev.houwert.argus.ui.compare.CompareSlotCard
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.inbox.ClearedProposalRow
import dev.houwert.argus.ui.inbox.InboxFilterMenu
import dev.houwert.argus.ui.inbox.ProposalCard
import dev.houwert.argus.ui.inbox.ProposalCardActions
import dev.houwert.argus.ui.inbox.ProposalCardContent
import dev.houwert.argus.ui.inbox.ProposalText
import dev.houwert.argus.ui.inbox.StartedProposalCard
import dev.houwert.argus.ui.inbox.StartedProposalRow
import dev.houwert.argus.ui.worktrees.WorktreeCleanupList
import dev.houwert.argus.ui.worktrees.WorktreeCleanupPolicyGroup

/** The inbox, blueprints, compare and worktree cleanup pieces, against a busy computer's fixtures. */
@Composable
internal fun InboxGalleryStories() {
  val now = System.currentTimeMillis().toDouble()
  val proposals = InboxFixtures.proposals(now)
  val runs = InboxFixtures.runs(now)
  val items = InboxItems(proposals, runs, setOf("s-billing", "s-docs"), now)
  var filter by remember { mutableStateOf(InboxFilter.all) }
  val options = items.filterOptions(filter) { id -> proposals.firstOrNull { it.automationId == id }?.automationName }

  Story("Inbox filter") {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      InboxFilterMenu(options, filter, { next, _ -> filter = next })
      MutedText(if (filter.isEmpty) "Everything" else "Showing ${options.summary(filter)}")
    }
  }
  Story("Proposal cards") {
    val pending = items.filtered(filter).pending
    pending.take(4).forEachIndexed { i, proposal ->
      ProposalCard(
        ProposalCardContent.from(proposal, "/Users/sam/Projects/${proposal.project}"),
        busy = false, starting = proposal.startStage != null, canDecide = true, actions = InboxFixtures.noActions,
        requestError = if (i == 3) "The worktree folder already exists." else null,
      )
    }
    ProposalCard(
      ProposalCardContent.from(proposals.first { it.status == RemoteProposalStatus.dismissed }),
      busy = false, starting = false, canDecide = true, actions = InboxFixtures.noActions,
      decided = ProposalText.decidedNote(proposals.first { it.status == RemoteProposalStatus.dismissed }),
    )
    ProposalCard(
      ProposalCardContent.from(pending.first()), busy = false, starting = false, canDecide = false, actions = InboxFixtures.noActions,
    )
  }
  Story("Started from this phone") {
    StartedProposalCard(proposals.first { it.status == RemoteProposalStatus.accepted }, onOpen = {}, onClose = {})
  }
  Story("Started and cleared rows") {
    ListSection(header = "Argus is on it · ${items.started.size}") { items.started.forEach { StartedProposalRow(it, onClick = {}) } }
    ListSection(header = "Argus cleared these · ${items.cleared.size}") { items.cleared.forEach { ClearedProposalRow(it, onClick = {}, nowMillis = now) } }
  }
  Story("Blueprints") {
    val blueprints = InboxFixtures.blueprints(now)
    ListSection { blueprints.forEach { BlueprintRow(it, onClick = {}, onNewProject = {}) } }
    ListSection(header = "Projects made from it") { InboxFixtures.blueprintRuns(now).forEach { BlueprintRunRow(it, onClick = if (it.sessionId != null) ({}) else null) } }
  }
  Story("Compare run") {
    val sessions = InboxFixtures.compareSessions()
    ListSection { CompareRunHeaderRow(CompareGroup("g1", sessions), onClick = {}) }
    val slots = InboxFixtures.compareSlots()
    CompareSlotCard(slots[0], "Claude Code", "Claude Opus 5.5", onOpen = {}, onKeep = {}, reviewComments = 2)
    CompareSlotCard(slots[1], "Codex", "GPT-5", onOpen = {}, onKeep = {}, loadingScreenshot = true)
    CompareSlotCard(slots[2], "Claude Code", "Claude Sonnet 4.5", onOpen = {}, onKeep = null)
    var landing by remember { mutableStateOf(CompareLanding.Merge) }
    var deleteOthers by remember { mutableStateOf(true) }
    Card { CompareKeepForm(landing, { landing = it }, deleteOthers, { deleteOthers = it }, "Codex", others = 2) }
  }
  Story("Worktree cleanup") {
    var preview by remember { mutableStateOf(InboxFixtures.worktreeCleanup(now)) }
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
      WorktreeCleanupPolicyGroup(preview.policy, canEdit = true) { next, _, _ -> preview = preview.copy(policy = next) }
      WorktreeCleanupList(preview, cleaning = false, canRun = true) {}
    }
  }
}

private object InboxFixtures {
  private const val HOUR = 3_600_000.0

  val noActions = ProposalCardActions(start = {}, requestRevision = {}, resolve = {}, dismiss = {}, cleanup = {}, openRun = {}, openDetails = {})

  private fun proposal(
    id: String, title: String, automation: Pair<String, String>, project: String?, status: RemoteProposalStatus, created: Double,
    cta: RemoteProposalCta? = null, confidence: Double = 0.82, extra: (RemoteProposal) -> RemoteProposal = { it },
  ) = extra(
    RemoteProposal(
      id = id, automationId = automation.first, automationName = automation.second, runId = "run-$id", title = title,
      summary = "The nightly run found this while reading the last day of commits and the open issues.",
      rationale = "Two users hit it this week, and the fix is contained to one module.", confidence = confidence, cta = cta,
      status = status, project = project, createdAt = created,
    ),
  )

  private val triage = "a-triage" to "Issue triage"
  private val deps = "a-deps" to "Dependency audit"
  private val cleanup = "a-cleanup" to "Branch cleanup"
  private val flaky = "a-flaky" to "Flaky tests"
  private fun start(label: String = "Start session") = RemoteProposalCta(RemoteProposalCtaKind.startSession, label, force = false)

  fun proposals(now: Double): List<RemoteProposal> = listOf(
    proposal("p1", "Fix the cart badge count after removing an item", triage, "storefront", RemoteProposalStatus.pending, now - 0.5 * HOUR, start()),
    proposal("p2", "Bump expo-router to 5.1 for the deep link fix", deps, "mobile", RemoteProposalStatus.pending, now - 2 * HOUR, start("Upgrade"), 0.64),
    proposal(
      "p3", "Delete the merged branch fix/safari-scroll", cleanup, "storefront", RemoteProposalStatus.pending, now - 3 * HOUR,
      RemoteProposalCta(RemoteProposalCtaKind.deleteBranch, "Delete branch", branch = "fix/safari-scroll", force = false), 0.95,
    ),
    proposal("p4", "Quarantine the checkout e2e test", flaky, "storefront", RemoteProposalStatus.pending, now - 5 * HOUR, start()) {
      it.copy(startStage = RemoteProposalStartStage("setting_up"))
    },
    proposal("p5", "Read the Stripe changelog before the API bump", deps, "api", RemoteProposalStatus.pending, now - 6 * HOUR,
      RemoteProposalCta(RemoteProposalCtaKind.openUrl, "Open changelog", url = "https://example.com/changelog", force = false), 0.55) {
      it.copy(sourceLabel = "ENG-412", sourceUrl = "https://example.com/ENG-412", revisionRequest = "Only the breaking changes, please.")
    },
    proposal("p6", "Add rate limits to the export endpoint", triage, "api", RemoteProposalStatus.pending, now - 8 * HOUR, start()),
    proposal("p7", "Retry the push token refresh", triage, "mobile", RemoteProposalStatus.accepted, now - 10 * HOUR) {
      it.copy(sessionId = "s-billing", agentId = "agent-1")
    },
    proposal("p8", "Rewrite the docs sidebar config", deps, "docs", RemoteProposalStatus.autoStarted, now - 12 * HOUR) {
      it.copy(sessionId = "s-docs", agentId = "agent-2")
    },
    proposal("p9", "Pin the Node version in CI", deps, "api", RemoteProposalStatus.superseded, now - 20 * HOUR) {
      it.copy(clearedReason = "the next run proposed it with the lockfile change", clearedAt = now - 3 * HOUR, supersededBy = "p2")
    },
    proposal("p10", "Investigate the slow search query", triage, "api", RemoteProposalStatus.withdrawn, now - 22 * HOUR) {
      it.copy(clearedReason = "the query was fixed upstream", clearedAt = now - 1 * HOUR)
    },
    proposal("p11", "Remove the unused feature flag", cleanup, "mobile", RemoteProposalStatus.dismissed, now - 30 * HOUR) {
      it.copy(dismissedReason = "still used by the beta build")
    },
    proposal("p12", "Split the settings screen", triage, "storefront", RemoteProposalStatus.resolved, now - 40 * HOUR),
  )

  fun runs(now: Double) = listOf(
    RemoteAutomationRun("r1", "a-flaky", "Flaky tests", false, RemoteAutomationRunStatus.failed, "schedule", now - HOUR, error = "The runner timed out after 30 minutes.", unreadReport = false),
    RemoteAutomationRun("r2", "a-deps", "Dependency audit", false, RemoteAutomationRunStatus.succeeded, "schedule", now - 2 * HOUR, unreadReport = true, reportPreview = "Three packages are a major version behind."),
    RemoteAutomationRun("r3", "a-triage", "Issue triage", false, RemoteAutomationRunStatus.running, "manual", now - 0.1 * HOUR, unreadReport = false),
  )

  private fun blueprint(id: String, name: String, summary: String, refs: List<String>, template: String? = null, now: Double) = Blueprint(
    id = id, name = name, summary = summary, parentDir = "~/Work",
    references = refs.map { BlueprintReference("/Users/sam/Projects/$it", "") },
    scaffold = template?.let { BlueprintScaffold.GithubTemplate(BlueprintScaffoldGithubTemplate("github_template", it)) }
      ?: BlueprintScaffold.Empty(BlueprintScaffoldEmpty("empty")),
    github = BlueprintGithub(true, "", BlueprintVisibility("private")), instructions = "", agent = BlueprintAgent(),
    createdAt = now, updatedAt = now,
  )

  fun blueprints(now: Double) = listOf(
    blueprint("b1", "Expo app", "A React Native app with the house navigation and theming.", listOf("mobile", "storefront"), now = now),
    blueprint("b2", "Mac app", "SwiftUI app with the release lanes and Sparkle feed.", listOf("argus", "grove"), now = now),
    blueprint("b3", "Docs site", "", emptyList(), "sam/docs-template", now),
    blueprint("b4", "API service", "Node service with the deploy workflow and health checks.", listOf("api"), now = now),
  )

  fun blueprintRuns(now: Double) = listOf(
    BlueprintRun("br1", "b2", "tally", "/Users/sam/Work/tally", status = BlueprintRunStatus.running, steps = emptyList(), startedAt = now - 0.05 * HOUR),
    BlueprintRun("br2", "b2", "ledger", "/Users/sam/Work/ledger", status = BlueprintRunStatus.failed, steps = emptyList(), startedAt = now - 26 * HOUR),
    BlueprintRun("br3", "b2", "notes", "/Users/sam/Work/notes", status = BlueprintRunStatus.done, steps = emptyList(), sessionId = "s-notes", startedAt = now - 72 * HOUR),
  )

  fun compareSessions() = (0L..2L).map {
    RemoteSession(
      id = "c$it", repoRoot = "/Users/sam/Projects/storefront", kind = RemoteSessionKind.worktree, branch = "compare/checkout-$it",
      displayName = "Redesign the checkout summary", status = RemoteSessionStatus.ready, compareGroup = SessionCompareGroup("g1", it),
    )
  }

  fun compareSlots() = listOf(
    RemoteCompareSlot(
      "c0", 0, agentId = "a0", agentStatus = RemoteCompareSlotAgentStatus.idle, diff = RemoteCompareSlotDiff(7, 212, 48),
      runs = listOf(RemoteCompareRun("Dev server", RemoteCompareRunState.passed, false), RemoteCompareRun("Unit tests", RemoteCompareRunState.passed, true)),
      costUsd = 1.84, tokens = 412_000, hasScreen = true,
    ),
    RemoteCompareSlot(
      "c1", 1, runnerId = "codex", model = "gpt-5", agentId = "a1", agentStatus = RemoteCompareSlotAgentStatus.running,
      diff = RemoteCompareSlotDiff(3, 90, 12), runs = listOf(RemoteCompareRun("Unit tests", RemoteCompareRunState.running, true)),
      costUsd = 0.006, tokens = 98_300, hasScreen = true,
    ),
    RemoteCompareSlot(
      "c2", 2, model = "sonnet", agentId = "a2", agentStatus = RemoteCompareSlotAgentStatus.error, diff = null,
      runs = listOf(RemoteCompareRun("Unit tests", RemoteCompareRunState.failed, true), RemoteCompareRun("Lint", RemoteCompareRunState.passed, true)),
      costUsd = 0.0, tokens = 0, hasScreen = false,
    ),
  )

  fun worktreeCleanup(now: Double): WorktreeCleanupPreview {
    val day = 86_400_000.0
    val gb = 1_073_741_824.0
    fun entry(project: String, branch: String, name: String?, size: Double, idle: Double, reason: WorktreeCleanupReason, landed: Double? = null, guard: WorktreeCleanupGuard? = null) =
      WorktreeCleanupEntry(
        sessionId = "$project-$branch", repoRoot = "/Users/sam/Projects/$project", projectName = project, branch = branch, displayName = name,
        bytes = size * gb, lastActivityAt = now - idle * day, landedAt = landed?.let { now - it * day }, reason = reason, blockedBy = guard,
      )
    return WorktreeCleanupPreview(
      policy = WorktreeCleanupPolicy(enabled = true, landedDays = 7, idleDays = 30, maxGb = 100.0),
      entries = listOf(
        entry("storefront", "feat/checkout-redesign", "Checkout redesign", 6.4, 21.0, WorktreeCleanupReason.landed, 18.0),
        entry("storefront", "fix/safari-scroll", "Safari scroll jump", 5.9, 15.0, WorktreeCleanupReason.landed, 11.0),
        entry("mobile", "feat/push-onboarding", "Push onboarding", 14.2, 52.0, WorktreeCleanupReason.idle),
        entry("docs", "auto/dependency-audit", "Dependency audit", 1.3, 34.0, WorktreeCleanupReason.idle),
        entry("mobile", "spike/offline-cache", null, 11.7, 6.0, WorktreeCleanupReason.overCap),
        entry("api", "feat/rate-limits", "Rate limits", 3.2, 45.0, WorktreeCleanupReason.idle, guard = WorktreeCleanupGuard.uncommitted),
        entry("storefront", "exp/server-islands", null, 4.8, 38.0, WorktreeCleanupReason.idle, guard = WorktreeCleanupGuard.unpushed),
        entry("mobile", "fix/android-keyboard", "Android keyboard", 9.6, 31.0, WorktreeCleanupReason.idle, guard = WorktreeCleanupGuard.agentRunning),
      ),
      totalBytes = 128.4 * gb,
      lastSweep = WorktreeCleanupSweep(
        at = now - 0.15 * day, trigger = WorktreeCleanupSweepTrigger.scheduled,
        removed = listOf(entry("storefront", "fix/cart-badge", "Cart badge count", 2.1, 12.0, WorktreeCleanupReason.landed, 9.0)),
        freedBytes = 2.9 * gb, failed = 0,
      ),
    )
  }
}
