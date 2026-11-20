package dev.houwert.argus.app.screens.git

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.git.DiffReviewPrompt
import dev.houwert.argus.core.git.ReviewGuideTarget
import dev.houwert.argus.core.git.submitPullRequestReview
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.discardReview
import dev.houwert.argus.core.stores.sendReview
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.ReviewDraftBar
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.ThemedTextField
import kotlinx.coroutines.launch

/** Whether this device holds the `control` grant, as state a screen recomposes on. */
@Composable
fun hasControl(): Boolean {
  val capabilities by LocalAppStore.current.host.capabilities.collectAsState()
  return "control" in capabilities
}

/** Opens an agent's chat with its name as the label. */
fun openAgent(host: HostStore, push: (Route) -> Unit, agentId: String) {
  val label = host.statusByAgent.value[agentId]?.let(Labels::agentName) ?: "Agent"
  push(Route.Agent(agentId, label))
}

/** A session's draft review pinned under the screen while it has comments: discard, or send to its agent. */
@Composable
fun SessionReviewBar(sessionId: String) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val drafts by app.host.reviews.bySession.collectAsState()
  val comments = drafts[sessionId].orEmpty()
  var sending by remember { mutableStateOf(false) }
  var discarding by remember { mutableStateOf(false) }
  if (!hasControl() || comments.isEmpty()) return
  ReviewDraftBar(comments, "Send to agent", busy = sending, onDiscard = { discarding = true }) {
    sending = true
    scope.launch {
      val agentId = app.host.sendReview(sessionId)
      sending = false
      if (agentId != null) openAgent(app.host, router::push, agentId)
    }
  }
  if (discarding) {
    ConfirmDialog(
      "Discard ${DiffReviewPrompt.plural(comments.size, "comment")}?", null, "Discard", destructive = true,
      onDismiss = { discarding = false },
    ) { app.host.discardReview(sessionId) }
  }
}

private val reviewEvents = listOf(
  MethodsTypes.GithubReviewPullRequestParamsEvent.cOMMENT to "Comment",
  MethodsTypes.GithubReviewPullRequestParamsEvent.aPPROVE to "Approve",
  MethodsTypes.GithubReviewPullRequestParamsEvent.rEQUESTCHANGES to "Request Changes",
)

/** A pull request's drafts under the screen: how many, discard, and finish as one review on its code host. */
@Composable
fun PullRequestReviewBar(repo: String, number: Int) {
  val app = LocalAppStore.current
  val scope = rememberCoroutineScope()
  val key = ReviewGuideTarget.PullRequest(repo, number).key
  val drafts by app.host.reviews.bySession.collectAsState()
  val comments = drafts[key].orEmpty()
  var finishing by remember { mutableStateOf(false) }
  var discarding by remember { mutableStateOf(false) }
  ReviewDraftBar(
    comments, "Finish Review", emptyTitle = "No comments yet", emptyHint = "Tap a line to comment",
    onDiscard = { discarding = true },
  ) { finishing = true }
  if (discarding) {
    ConfirmDialog(
      "Discard ${DiffReviewPrompt.plural(comments.size, "comment")}?", null, "Discard", destructive = true,
      onDismiss = { discarding = false },
    ) { app.host.discardReview(key) }
  }
  if (finishing) {
    var event by rememberSaveable { mutableStateOf(MethodsTypes.GithubReviewPullRequestParamsEvent.cOMMENT.rawValue) }
    var text by rememberSaveable { mutableStateOf("") }
    var posting by remember { mutableStateOf(false) }
    // GitHub wants a body for everything but an approval.
    val canPost = !posting && (event == "APPROVE" || comments.isNotEmpty() || text.isNotBlank())
    FormSheet("Finish Review", "Post", confirmEnabled = canPost, onDismiss = { finishing = false }, onConfirm = {
      posting = true
      scope.launch {
        val posted = app.host.submitPullRequestReview(repo, number, MethodsTypes.GithubReviewPullRequestParamsEvent(event), text.trim())
        posting = false
        if (posted) finishing = false
      }
    }) {
      SegmentedControl(event, reviewEvents.map { it.first.rawValue to it.second }) { event = it }
      ThemedTextField(text, { text = it }, "Summary (optional)", multiline = true, lines = 3..8)
      MutedText(
        if (comments.isNotEmpty()) "With ${DiffReviewPrompt.plural(comments.size, "inline comment")}. It's posted as you." else "It's posted as you."
      )
    }
  }
}
