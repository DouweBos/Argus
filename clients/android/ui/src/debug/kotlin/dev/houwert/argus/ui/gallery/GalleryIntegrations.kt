package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.IssueFilter
import dev.houwert.argus.core.stores.IssueFilters
import dev.houwert.argus.core.stores.LinearIssueDetailModel
import dev.houwert.argus.kit.protocol.generated.LinearAttachment
import dev.houwert.argus.kit.protocol.generated.LinearComment
import dev.houwert.argus.kit.protocol.generated.LinearCommentReactionsItem
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEvent
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEventKind
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearIssueCycle
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetail
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailChildrenItem
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailChildrenItemState
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailCycle
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailLabelColorsItem
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailProject
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailRelationsItem
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailRelationsItemState
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailStatusHistoryItem
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailSubscribersItem
import dev.houwert.argus.kit.protocol.generated.LinearIssueLabelColorsItem
import dev.houwert.argus.kit.protocol.generated.LinearIssueParent
import dev.houwert.argus.kit.protocol.generated.LinearIssueProject
import dev.houwert.argus.kit.protocol.generated.LinearIssueScope
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import dev.houwert.argus.kit.protocol.generated.LinkedIssue
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.util.LinearMediaLink
import dev.houwert.argus.ui.integrations.IssueFilterBar
import dev.houwert.argus.ui.integrations.IssueStatusGlyph
import dev.houwert.argus.ui.integrations.LinearIssueCard
import dev.houwert.argus.ui.integrations.LinearIssueDetailView
import dev.houwert.argus.ui.integrations.LinearIssuesList
import dev.houwert.argus.ui.integrations.LinearIssuesPlaceholder
import dev.houwert.argus.ui.integrations.LinearMediaEmbed
import dev.houwert.argus.ui.integrations.LinkedIssueChip
import dev.houwert.argus.ui.integrations.PickedIssueChips
import dev.houwert.argus.ui.integrations.PriorityGlyph

private const val DAY = 86_400_000.0
private val now = System.currentTimeMillis().toDouble()

private val workflow = listOf(
  LinearWorkflowState("triage", "Triage", "triage", 0.0, "#fc7840"),
  LinearWorkflowState("backlog", "Backlog", "backlog", 0.0, "#bec2c8"),
  LinearWorkflowState("todo", "Todo", "unstarted", 1.0, "#e2e2e2"),
  LinearWorkflowState("progress", "In Progress", "started", 2.0, "#f2c94c"),
  LinearWorkflowState("review", "In Review", "started", 3.0, "#0f783c"),
  LinearWorkflowState("done", "Done", "completed", 4.0, "#5e6ad2"),
  LinearWorkflowState("canceled", "Canceled", "canceled", 5.0, "#95a2b3"),
)

private val labelColors = listOf(
  LinearIssueLabelColorsItem("Bug", "#eb5757"), LinearIssueLabelColorsItem("iOS", "#5e6ad2"),
  LinearIssueLabelColorsItem("Android", "#4cb782"), LinearIssueLabelColorsItem("Design", "#f2994a"),
)

private fun issue(
  n: Int, title: String, state: String, priority: Int, assignee: String? = "Ada Lovelace", labels: List<String> = emptyList(),
  estimate: Double? = null, project: String? = null, cycle: Boolean = false, parent: Boolean = false, prs: Int = 0, ageDays: Double = 3.0,
) = LinearIssue(
  id = "i$n", identifier = "ENG-$n", title = title, description = "", url = "https://linear.app/acme/issue/ENG-$n",
  branchName = "ada/eng-$n", state = workflow.first { it.id == state }, priority = priority.toDouble(), estimate = estimate,
  labelColors = labelColors.filter { it.name in labels }, teamId = "eng", teamKey = "ENG", teamName = "Engineering",
  assignee = assignee, labels = labels, project = project?.let { LinearIssueProject("p-$it", it) },
  cycle = if (cycle) LinearIssueCycle("c59", 59.0, null, true) else null,
  parent = if (parent) LinearIssueParent("ENG-100", "Android client") else null,
  pullRequestCount = prs.toDouble(), createdAt = now - ageDays * 30 * DAY, updatedAt = now - ageDays * DAY,
)

internal val galleryIssues = listOf(
  issue(201, "Crash when opening a session with no agents", "triage", 1, labels = listOf("Bug", "Android")),
  issue(202, "Port the issues screen to Android", "progress", 2, estimate = 5.0, project = "Android", cycle = true, parent = true, prs = 1),
  issue(203, "Figma viewer: pinch to zoom on the frame", "progress", 3, estimate = 3.0, project = "Android", cycle = true, labels = listOf("Design")),
  issue(204, "Filter chips lose their order after a refresh", "review", 2, labels = listOf("Bug"), prs = 2, cycle = true),
  issue(205, "Push notifications through FCM", "todo", 2, estimate = 8.0, project = "Android"),
  issue(206, "Home screen widget for sessions that need you", "todo", 3, assignee = null, project = "Android"),
  issue(207, "Lock screen shows the wrong computer name", "todo", 4, labels = listOf("Bug", "iOS")),
  issue(208, "Dark theme contrast on muted labels", "backlog", 4, assignee = "Grace Hopper", labels = listOf("Design")),
  issue(209, "Share sheet target for links", "backlog", 0, assignee = null),
  issue(210, "Release CI uploads the signed bundle", "backlog", 3, estimate = 2.0),
  issue(211, "Usage view on tablets", "done", 3, prs = 1),
  issue(212, "Account switching when one hits its limit", "review", 1, assignee = "Grace Hopper", prs = 1, ageDays = 1.0),
)

private val galleryDetail = LinearIssueDetail(
  id = "i202", identifier = "ENG-202", title = "Port the issues screen to Android",
  description = "Match the iPhone's **Issues** screen: a section per status, filters like Linear's, and the issue page.\n\n" +
    "- Pull to refresh\n- Search the whole workspace\n- Change status and priority\n\n" +
    "Design: https://www.figma.com/design/k/App?node-id=1-2\n\n![Screenshot of the list](https://uploads.linear.app/a/b/list.png)",
  url = "https://linear.app/acme/issue/ENG-202", branchName = "ada/eng-202-port-the-issues-screen",
  state = workflow[3], priority = 2.0, estimate = 5.0, estimateType = "fibonacci",
  labelColors = listOf(LinearIssueDetailLabelColorsItem("Android", "#4cb782"), LinearIssueDetailLabelColorsItem("Design", "#f2994a")),
  teamId = "eng", teamKey = "ENG", teamName = "Engineering", assignee = "Ada Lovelace", creator = "Grace Hopper",
  dueDate = "2026-12-04", labels = listOf("Android", "Design"), project = LinearIssueDetailProject("p", "Android"),
  cycle = LinearIssueDetailCycle("c59", 59.0, null, true), parent = null, pullRequestCount = 1.0,
  createdAt = now - 12 * DAY, updatedAt = now - DAY,
  comments = listOf(
    LinearComment("c1", null, "Grace Hopper", body = "Can the filters remember themselves per scope, like on the Mac?", createdAt = now - 5 * DAY,
      reactions = listOf(LinearCommentReactionsItem("+1", 2.0))),
    LinearComment("c2", "c1", "Ada Lovelace", body = "Yes, they're stored under the same key as the other clients.", createdAt = now - 4 * DAY),
    LinearComment("c3", null, "Ada Lovelace", body = "First pass is up for review.", createdAt = now - DAY),
  ),
  history = listOf(
    LinearHistoryEvent("h0", now - 12 * DAY, "Grace Hopper", kind = LinearHistoryEventKind.created, text = "created the issue"),
    LinearHistoryEvent("h1", now - 11 * DAY, "Grace Hopper", kind = LinearHistoryEventKind.assignee, text = "assigned to Ada Lovelace"),
    LinearHistoryEvent("h2", now - 10 * DAY, "Grace Hopper", kind = LinearHistoryEventKind.priority, text = "set priority to High"),
    LinearHistoryEvent("h3", now - 10 * DAY, null, kind = LinearHistoryEventKind.cycle, text = "added the issue to Cycle 59"),
    LinearHistoryEvent("h4", now - 9 * DAY, "Ada Lovelace", kind = LinearHistoryEventKind.estimate, text = "set the estimate to 5 points"),
    LinearHistoryEvent("h5", now - 6 * DAY, "Ada Lovelace", kind = LinearHistoryEventKind.status, text = "moved from Todo to In Progress"),
    LinearHistoryEvent("h6", now - 2 * DAY, "Ada Lovelace", kind = LinearHistoryEventKind.attachment, text = "linked a pull request"),
  ),
  subscribers = listOf(LinearIssueDetailSubscribersItem("Ada Lovelace"), LinearIssueDetailSubscribersItem("Grace Hopper")),
  relations = listOf(
    LinearIssueDetailRelationsItem("blocked_by", "ENG-198", "Generated Kotlin wire types", LinearIssueDetailRelationsItemState("Done", "completed")),
    LinearIssueDetailRelationsItem("related", "ENG-203", "Figma viewer: pinch to zoom", LinearIssueDetailRelationsItemState("In Progress", "started")),
  ),
  statusHistory = listOf(
    LinearIssueDetailStatusHistoryItem("Backlog", "backlog", now - 12 * DAY),
    LinearIssueDetailStatusHistoryItem("Todo", "unstarted", now - 10 * DAY),
    LinearIssueDetailStatusHistoryItem("In Progress", "started", now - 6 * DAY),
  ),
  attachments = listOf(LinearAttachment("Port the issues screen", now - 2 * DAY, "#4821", "https://github.com/acme/app/pull/4821", "github")),
  children = listOf(
    LinearIssueDetailChildrenItem("ENG-213", "Issue filter sheet", LinearIssueDetailChildrenItemState("Done", "completed")),
    LinearIssueDetailChildrenItem("ENG-214", "Property menus", LinearIssueDetailChildrenItemState("In Progress", "started")),
  ),
)

@Composable
internal fun IntegrationsGalleryPage() {
  Story("Status and priority") {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      for (type in listOf("triage", "backlog", "unstarted", "started", "completed", "canceled")) IssueStatusGlyph(type, size = 20.dp)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      for (priority in listOf(1, 2, 3, 4, 0)) PriorityGlyph(priority, size = 20.dp)
    }
  }
  Story("Issue cards") {
    LinearIssueCard(galleryIssues[1], agentOnIt = true)
    LinearIssueCard(galleryIssues[0], agentOnIt = false, selected = true)
  }
  Story("Filters") {
    var filters by remember { mutableStateOf(listOf(IssueFilters.currentCycle, IssueFilter(IssueFilter.Field.Priority, values = listOf("1", "2")))) }
    IssueFilterBar(galleryIssues, filters, { filters = it }, states = workflow)
  }
  Story("Issues") {
    Box(Modifier.fillMaxWidth().height(640.dp)) {
      LinearIssuesList(galleryIssues, agentOnIt = { it.identifier == "ENG-202" }, onOpen = {}, selected = "ENG-204", contentPadding = PaddingValues(0.dp))
    }
  }
  Story("Placeholders") {
    for ((connected, issues) in listOf(false to null, true to null, true to emptyList<LinearIssue>())) {
      Box(Modifier.fillMaxWidth().height(220.dp)) {
        LinearIssuesPlaceholder(
          connected, "Connect Linear in Argus on your computer to see your issues here.", LinearIssueScope.assigned,
          query = null, issues = issues, shownIssues = issues, error = null,
        )
      }
    }
  }
  Story("Issue") {
    val host = rememberGalleryHost(
      reply(Methods.LinearIssue, MethodsTypes.LinearIssueResult(galleryDetail, workflow)),
      reply(Methods.LinearComment, MethodsTypes.LinearCommentResult(true)),
    )
    val model = remember { LinearIssueDetailModel("ENG-202", host) }
    Box(Modifier.fillMaxWidth().height(900.dp)) {
      LinearIssueDetailView(model, canEdit = true, canStart = true, sessionOnIt = null, onOpenSession = {}, onStart = {}, onOpenIssue = {}, onOpenDesign = {})
    }
  }
  Story("References") {
    LinkedIssueChip(LinkedIssue("linear", "ENG-202", "Port the issues screen to Android", "https://linear.app/acme/issue/ENG-202"), onOpen = {})
    PickedIssueChips(galleryIssues.take(3), onRemove = {})
    LinearMediaEmbed(LinearMediaLink(LinearMediaLink.Kind.VIDEO, "https://uploads.linear.app/a/b/repro.mov", "repro.mov"), onOpen = {})
  }
  DesignGalleryStories()
}
