package dev.houwert.argus.app.screens.git

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.git.DiffReviewComment
import dev.houwert.argus.core.git.ReviewGuideTarget
import dev.houwert.argus.core.git.askAboutStop
import dev.houwert.argus.core.git.generateReviewGuide
import dev.houwert.argus.core.git.loadReviewGuide
import dev.houwert.argus.core.git.markStopVisited
import dev.houwert.argus.core.git.trackReviewGuideOpened
import dev.houwert.argus.core.stores.addReviewComment
import dev.houwert.argus.core.stores.deleteReviewComment
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuide
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideStateStatus
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideStop
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ChangeCounts
import dev.houwert.argus.ui.components.DiffHunksView
import dev.houwert.argus.ui.components.DividedColumn
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.ReviewGuideHeader
import dev.houwert.argus.ui.components.ReviewGuidePlaceholder
import dev.houwert.argus.ui.components.ReviewGuideStopRow
import dev.houwert.argus.ui.components.ReviewableDiffHunksView
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.FileTypeIcon
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A session's or pull request's review guide: the stops, then one at a time with Next. */
@Composable
fun ReviewGuideScreen(target: ReviewGuideTarget, label: String) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  val control = hasControl()
  val states by host.reviewGuides.states.collectAsState()
  val errors by host.reviewGuides.errors.collectAsState()
  val visitedAll by host.reviewGuides.visited.collectAsState()
  val drafts by host.reviews.bySession.collectAsState()
  val state = states[target.key]
  val error = errors[target.key]
  val guide = state?.guide
  val generating = state?.status == RemoteReviewGuideStateStatus.generating
  var selected by rememberSaveable { mutableStateOf<String?>(null) }

  // Loads it, then polls while one is being written.
  LaunchedEffect(target) {
    host.loadReviewGuide(target)
    if (host.reviewGuides.state(target)?.guide != null) host.trackReviewGuideOpened(target)
  }
  LaunchedEffect(target, generating) {
    while (generating && host.reviewGuides.state(target)?.status == RemoteReviewGuideStateStatus.generating) {
      delay(3_000)
      host.loadReviewGuide(target)
    }
  }
  // Back from a stop returns to the list before it leaves the screen.
  BackHandler(selected != null) { selected = null }

  fun write(force: Boolean) {
    scope.launch { host.generateReviewGuide(target, force) }
  }

  val actions = when {
    selected != null -> listOf(BarAction("All stops", Icons.menu) { selected = null })
    control && guide != null && !generating -> listOf(BarAction("Rewrite guide", Icons.refresh) { write(true) })
    else -> emptyList()
  }
  GitScaffold(label, actions, bottomBar = {
    when (target) {
      is ReviewGuideTarget.Session -> SessionReviewBar(target.id)
      is ReviewGuideTarget.PullRequest -> if (control && guide != null) PullRequestReviewBar(target.repo, target.number)
    }
  }) {
    Screen {
      if (error != null && guide != null) Banner(error, tone = dev.houwert.argus.ui.theme.Tone.Danger)
      if (guide == null) {
        ReviewGuidePlaceholder(state, error, control) { write(false) }
        return@Screen
      }
      val index = guide.stops.indexOfFirst { it.id == selected }
      if (index >= 0) {
        StopView(target, guide, index, onSelect = { selected = it })
      } else {
        val visited = visitedAll[target.key].orEmpty()
        Card {
          ReviewGuideHeader(guide, stale = state.stale, visited = visited.size, canRewrite = control, overview = { SelectionContainer { BodyText(it) } }) { write(true) }
        }
        if (generating) MutedText("Rewriting the guide")
        Card {
          DividedColumn {
            guide.stops.forEachIndexed { i, stop ->
              val interaction = rememberInteraction()
              val comments = stop.paths.sumOf { path -> drafts[target.key].orEmpty().count { it.path == path } }
              ReviewGuideStopRow(
                i, stop, stop.id in visited,
                Modifier.argusClickable(interaction, label = "Open stop ${i + 1}") { selected = stop.id }.padding(vertical = 8.dp),
                comments = comments,
              )
            }
          }
        }
      }
    }
  }
}

/**
 * One stop on a review guide: why it matters, what to judge, the hunks it points at (tap a
 * line to comment), and questions about it.
 */
@Composable
private fun StopView(target: ReviewGuideTarget, guide: RemoteReviewGuide, index: Int, onSelect: (String?) -> Unit) {
  val host = LocalAppStore.current.host
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val control = hasControl()
  val stop = guide.stops[index]
  val drafts by host.reviews.bySession.collectAsState()
  val answersAll by host.reviewGuides.answers.collectAsState()
  val asking by host.reviewGuides.asking.collectAsState()
  host.reviewGuides.files.collectAsState().value
  var composing by remember { mutableStateOf<Composing?>(null) }
  var question by rememberSaveable(stop.id) { mutableStateOf("") }
  val isAsking = "${target.key}/${stop.id}" in asking
  LaunchedEffect(stop.id) { host.markStopVisited(target, stop.id) }

  Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        MutedText("Stop ${index + 1} of ${guide.stops.size}")
        if (stop.mechanical) Badge("Mechanical")
      }
      SelectionContainer { Text(stop.title, color = theme.text, style = argusFont(20, FontWeight.SemiBold)) }
      if (stop.summary.isNotEmpty()) SelectionContainer { Text(stop.summary, color = theme.text, style = argusFont(13)) }
    }
    if (stop.lookClosely.isNotEmpty()) LookClosely(stop, target.sessionId)
    for (file in host.reviewGuides.files(target, stop)) {
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          FileTypeIcon(file.displayPath, size = 13.dp)
          MonoText(file.displayPath, Modifier.weight(1f), size = 12, color = theme.text, maxLines = 1, truncateHead = true)
          ChangeCounts(file.additions, file.deletions)
        }
        if (control) {
          ReviewableDiffHunksView(
            file, drafts[target.key].orEmpty().filter { it.path == file.displayPath },
            onTapLine = { hunk, line -> DiffReviewComment.draft(file.displayPath, hunk, line, target.scope)?.let { composing = Composing(it, true) } },
            onEdit = { composing = Composing(it, false) },
            onDelete = { host.deleteReviewComment(it.id, target.key) },
          )
        } else {
          DiffHunksView(file)
        }
      }
    }
    // Ask about this stop.
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.sideQuestion, null, Modifier.size(13.dp), tint = theme.textMuted)
        Text("Ask about this stop", color = theme.textMuted, style = argusFont(12, FontWeight.SemiBold))
      }
      for (answer in answersAll["${target.key}/${stop.id}"].orEmpty()) {
        Column(
          Modifier.fillMaxWidth().background(theme.bgSecondary, RoundedCornerShape(ArgusMetrics.radiusSmall)).padding(10.dp),
          verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Text(answer.question, color = theme.text, style = argusFont(13, FontWeight.Medium))
          SelectionContainer { Text(answer.answer, color = theme.text, style = argusFont(13)) }
        }
      }
      if (control) {
        val send = {
          val text = question.trim()
          if (text.isNotEmpty()) {
            question = ""
            scope.launch { host.askAboutStop(target, stop.id, text) }
          }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          ThemedTextField(question, { question = it }, "Why is this needed? What happens if", Modifier.weight(1f), enabled = !isAsking, onSubmit = { send() })
          Btn("Ask", tone = ButtonTone.Secondary, small = true, hugs = true, busy = isAsking, enabled = !isAsking && question.isNotBlank()) { send() }
        }
      }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
      if (index > 0) Btn("Previous", tone = ButtonTone.Ghost, small = true, hugs = true, icon = Icons.chevronLeft) { onSelect(guide.stops[index - 1].id) }
      Spacer(Modifier.weight(1f))
      Btn("Next Stop", small = true, hugs = true, icon = Icons.chevronRight) {
        onSelect(if (index < guide.stops.size - 1) guide.stops[index + 1].id else null)
      }
    }
  }
  composing?.let { c ->
    CommentSheet(c, onDismiss = { composing = null }) { body ->
      if (c.isNew) host.addReviewComment(c.comment.copy(body = body), target.key) else host.reviews.update(c.comment.id, body, target.key)
    }
  }
}

@Composable
private fun LookClosely(stop: RemoteReviewGuideStop, sessionId: String?) {
  val theme = ArgusTheme.colors
  val router = LocalRouter.current
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(Icons.eye, null, Modifier.size(13.dp), tint = theme.warning)
      Text("Look closely", color = theme.warning, style = argusFont(12, FontWeight.SemiBold))
    }
    for (flag in stop.lookClosely) {
      Column(
        Modifier.fillMaxWidth().background(theme.warningSoft, RoundedCornerShape(ArgusMetrics.radiusSmall)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
      ) {
        SelectionContainer { Text(flag.note, color = theme.text, style = argusFont(13)) }
        flag.path?.let { path ->
          val location = flag.line?.let { "$path:${it.toInt()}" } ?: path
          val line = flag.line?.toInt()
          // Opens the file where the target has a checkout to read it from.
          if (sessionId != null && line != null) {
            dev.houwert.argus.ui.components.AccentLink(location, size = 11) { router.push(Route.File(sessionId, path, line, "changes")) }
          } else {
            MonoText(location, size = 11, color = theme.textMuted, maxLines = 1, truncateHead = true)
          }
        }
      }
    }
  }
}

/** The way into a review guide from a session's changes or a pull request. */
@Composable
fun ReviewGuideLink(target: ReviewGuideTarget, label: String) {
  val router = LocalRouter.current
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    Modifier.fillMaxWidth().argusClickable(interaction, label = "Open the review guide") { router.push(Route.ReviewGuide(target, label)) }.padding(vertical = 4.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(Icons.guide, null, Modifier.size(18.dp), tint = theme.accent)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text("Review guide", color = theme.text, style = argusFont(14, FontWeight.SemiBold))
      MutedText("A tour of the changes, stop by stop", maxLines = 1)
    }
    Icon(Icons.chevronRight, null, Modifier.size(12.dp), tint = theme.textMuted)
  }
}
