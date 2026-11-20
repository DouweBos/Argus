package dev.houwert.argus.app.screens.git

import dev.houwert.argus.ui.transcript.MarkdownView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.git.ReviewGuideTarget
import dev.houwert.argus.core.pullrequests.CheckTone
import dev.houwert.argus.core.pullrequests.PullRequestBucket
import dev.houwert.argus.core.pullrequests.RemoteMergeStrategy
import dev.houwert.argus.core.pullrequests.checksPassing
import dev.houwert.argus.core.pullrequests.tone
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.ViewedFiles
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemotePullRequest
import dev.houwert.argus.kit.protocol.generated.RemotePullRequestDetail
import dev.houwert.argus.kit.protocol.generated.RemoteViewedFileState
import dev.houwert.argus.kit.util.DiffFile
import dev.houwert.argus.kit.util.DiffParser
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ChangeCounts
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.FileDiffCard
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.PullRequestLabels
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.ViewedProgressBar
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.launch

/** Every pull request the computer thinks is yours to look at, bucketed as the Mac does: what needs you first. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun PullRequestsScreen() {
  val app = LocalAppStore.current
  val store = app.pullRequests
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val connection by app.host.connection.collectAsState()
  val prs by store.pullRequests.collectAsState()
  val loaded by store.loaded.collectAsState()
  val error by store.error.collectAsState()
  var refreshing by remember { mutableStateOf(false) }
  LaunchedEffect(Unit) { store.refresh() }
  LiveRefresh(connection == Transport.State.Ready, 30.seconds) { store.refresh() }
  val groups = PullRequestBucket.group(prs)

  GitScaffold("Pull Requests") {
    PullToRefreshBox(refreshing, onRefresh = {
      refreshing = true
      scope.launch {
        store.refresh()
        refreshing = false
      }
    }, Modifier.fillMaxSize()) {
      LoadPhaseBox(
        loaded, error?.let(PullRequestLabels::explain), prs.isEmpty(), Modifier.fillMaxSize(),
        loadingLabel = "Loading pull requests", failedTitle = "Couldn't fetch pull requests",
        onRetry = { scope.launch { store.refresh() } },
        empty = { EmptyState(Icons.pullRequests, "No pull requests", body = "Nothing open that's yours to review or land.") },
      ) {
        Screen {
          error?.let { Banner(PullRequestLabels.explain(it), tone = Tone.Danger) }
          if (groups.none { it.bucket.needsAttention }) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
              Icon(Icons.check, null, Modifier.size(14.dp), tint = ArgusTheme.colors.textMuted)
              MutedText("Nothing waiting on you right now.")
            }
          }
          for (group in groups) {
            ListSection(header = "${group.bucket.title} · ${group.prs.size}") {
              for (pr in group.prs) {
                PullRequestRow(pr) { router.push(Route.PullRequest(pr.repo, pr.number.toInt(), pr.title)) }
              }
            }
          }
        }
      }
    }
  }
}

/** One PR in the list: what it is, its review state, who and where, and why you're seeing it. */
@Composable
private fun PullRequestRow(pr: RemotePullRequest, onOpen: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val author = pr.author?.let { "by $it" } ?: "unknown author"
  Row(
    Modifier.fillMaxWidth().argusClickable(interaction, label = "Open ${pr.title}", onClick = onOpen).padding(horizontal = 16.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Icon(Icons.pullRequest, null, Modifier.padding(top = 2.dp).size(16.dp), tint = if (pr.isDraft) theme.textMuted else theme.success)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        BodyText(pr.title, Modifier.weight(1f), maxLines = 2)
        if (pr.isDraft) Badge("Draft")
        pr.reviewDecision?.let(PullRequestLabels::review)?.let { (label, tone) -> Badge(label, tone = tone) }
      }
      MutedText("${pr.repo} ${PullRequestLabels.ref(pr.number.toInt(), pr.url)} · $author · updated ${PullRequestLabels.relative(pr.updatedAt)}", maxLines = 2)
      dev.houwert.argus.ui.components.FlowRow(spacing = 4.dp, rowSpacing = 4.dp, packed = true) {
        for (reason in pr.reasons) Badge(PullRequestLabels.reason(reason), tone = PullRequestLabels.reasonTone(reason))
        Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(Icons.branch, null, Modifier.size(11.dp), tint = theme.textSecondary)
          Text(pr.headRef, color = theme.textSecondary, style = argusFont(11, mono = true), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
        }
      }
    }
  }
}

/** One pull request: what it says, whether CI is happy, the conversation, its files, and merge and comment with control. */
@Composable
fun PullRequestScreen(repo: String, number: Int, label: String) {
  val app = LocalAppStore.current
  val host = app.host
  val store = app.pullRequests
  val scope = rememberCoroutineScope()
  val control = hasControl()
  val connection by host.connection.collectAsState()
  val details by store.detailById.collectAsState()
  val storeError by store.error.collectAsState()
  val detail = details["$repo#$number"]
  var files by remember { mutableStateOf<List<DiffFile>?>(null) }
  var filesFailure by remember { mutableStateOf<String?>(null) }
  val viewed = remember(repo, number) { ViewedFiles(ViewedFiles.Scope.PullRequest(repo, number), host) }
  val viewedStates by viewed.states.collectAsState()
  val viewedError by viewed.error.collectAsState()

  LaunchedEffect(repo, number) {
    launch { viewed.load() }
    launch {
      try {
        files = DiffParser.parse(store.diff(repo, number))
        filesFailure = null
      } catch (e: Exception) {
        if (!HostStore.isQuiet(e)) filesFailure = HostStore.describe(e)
      }
    }
    store.loadDetail(repo, number)
  }
  LiveRefresh(connection == Transport.State.Ready, 30.seconds) {
    store.loadDetail(repo, number)
    // A push since flips viewed files to changed; GitHub decides which.
    viewed.load()
  }

  GitScaffold(detail?.title ?: label) {
    Screen {
      storeError?.let { Banner(PullRequestLabels.explain(it), tone = Tone.Danger) }
      if (detail == null) {
        Loading("Reading the pull request")
        return@Screen
      }
      Header(detail)
      if (detail.changedFiles > 0) {
        Card { ReviewGuideLink(ReviewGuideTarget.PullRequest(repo, number, detail.headSha), "#$number guide") }
      }
      if (detail.checks.isNotEmpty()) Checks(detail)
      if (detail.body.isNotEmpty()) Card { SelectionContainer { MarkdownView(detail.body, baseSize = 14) } }
      if (detail.comments.isNotEmpty()) {
        SectionHeader("Conversation", count = detail.comments.size)
        for (entry in detail.comments) {
          Card {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
              BodyText(entry.author ?: "someone")
              entry.reviewState?.let { Badge(it.lowercase(), tone = if (it == "APPROVED") Tone.Success else Tone.Muted) }
            }
            SelectionContainer { MarkdownView(entry.body, baseSize = 13) }
          }
        }
      }
      val list = files
      if (!list.isNullOrEmpty()) {
        // Every changed file, folded; a viewed one stays folded, as on GitHub.
        SectionHeader("Files", count = list.size)
        ViewedProgressBar(list.count { viewedStates[it.displayPath] == RemoteViewedFileState.viewed }, list.size)
        viewedError?.let { Banner(it, tone = Tone.Danger) }
        for (file in list) {
          FileDiffCard(
            file, viewedState = viewedStates[file.displayPath], showsViewed = true,
            onViewedChange = if (control) { on -> scope.launch { viewed.set(file.displayPath, on) } } else null,
          )
        }
      } else {
        filesFailure?.let { MutedText("Couldn't load the files — $it") }
      }
      if (control && !detail.merged) Actions(repo, number, detail)
    }
  }
}

@Composable
private fun Header(detail: RemotePullRequestDetail) {
  val (stateLabel, stateTone) = when {
    detail.merged -> "merged" to Tone.Accent
    detail.isDraft -> "draft" to Tone.Muted
    detail.state == "CLOSED" -> detail.state.lowercase() to Tone.Danger
    else -> detail.state.lowercase() to Tone.Success
  }
  Card {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      MutedText("${detail.repo} #${detail.number.toInt()}", Modifier.weight(1f), maxLines = 1)
      Badge(stateLabel, tone = stateTone)
    }
    MutedText("${detail.headRef} → ${detail.baseRef}", maxLines = 1)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
      ChangeCounts(detail.additions.toInt(), detail.deletions.toInt())
      MutedText("${detail.changedFiles.toInt()} files")
      detail.author?.let { MutedText("by $it") }
    }
    if (detail.mergeable == "CONFLICTING") Banner("This branch conflicts with its base.", tone = Tone.Warning)
  }
}

@Composable
private fun Checks(detail: RemotePullRequestDetail) {
  Card {
    SectionHeader("Checks", count = detail.checks.size)
    for (check in detail.checks) {
      val tone = when (check.tone) {
        CheckTone.Success -> Tone.Success
        CheckTone.Danger -> Tone.Danger
        CheckTone.Warning -> Tone.Warning
        CheckTone.Muted -> Tone.Muted
      }
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        StatusDot(tone, pulse = check.tone == CheckTone.Warning)
        BodyText(check.name, Modifier.weight(1f), maxLines = 1)
        MutedText(check.conclusion ?: check.status ?: "", maxLines = 1)
      }
    }
  }
}

/** Comment, and merge as a split button: the remembered strategy, the others behind the chevron. */
@Composable
private fun Actions(repo: String, number: Int, detail: RemotePullRequestDetail) {
  val app = LocalAppStore.current
  val store = app.pullRequests
  val scope = rememberCoroutineScope()
  val theme = ArgusTheme.colors
  var comment by rememberSaveable { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var strategy by remember { mutableStateOf(RemoteMergeStrategy.of(app.preferences.string(RemoteMergeStrategy.PREFERENCE_KEY))) }
  var picking by remember { mutableStateOf(false) }
  var confirming by remember { mutableStateOf(false) }
  val conflicting = detail.mergeable == "CONFLICTING"
  Card {
    ThemedTextField(comment, { comment = it }, "Leave a comment", multiline = true)
    Btn(if (busy) "Working" else "Comment", tone = ButtonTone.Secondary, small = true, enabled = !busy && comment.isNotBlank()) {
      busy = true
      scope.launch {
        if (store.comment(repo, number, comment.trim())) comment = ""
        busy = false
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      Btn(if (busy) "Merging" else strategy.label, Modifier.weight(1f), small = true, icon = Icons.merge, enabled = !busy && !conflicting) { confirming = true }
      Box {
        IconBtn(Icons.chevronDown, "Merge strategy, ${strategy.label}", tint = theme.text, enabled = !busy && !conflicting) { picking = true }
        DropdownMenu(picking, { picking = false }, containerColor = theme.surface) {
          for (option in RemoteMergeStrategy.entries) {
            DropdownMenuItem(
              { Text(option.label, style = argusFont(15)) },
              {
                picking = false
                strategy = option
                app.preferences.set(option.wire, RemoteMergeStrategy.PREFERENCE_KEY)
              },
              trailingIcon = if (option == strategy) ({ Icon(Icons.check, "Selected", tint = theme.accent) }) else null,
            )
          }
        }
      }
    }
    if (!detail.checksPassing && detail.checks.isNotEmpty()) MutedText("Checks aren't green yet.")
  }
  if (confirming) {
    ConfirmDialog(
      "Merge this pull request?", "${strategy.label} on ${PullRequestLabels.host(detail.url)}. This can't be undone from here.", "Merge",
      onDismiss = { confirming = false },
    ) {
      busy = true
      scope.launch {
        store.merge(repo, number, strategy)
        busy = false
      }
    }
  }
}
