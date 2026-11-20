package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.git.DiffReviewPrompt
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuide
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideState
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideStateStatus
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideStop
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** What the guide says before its stops: the change in brief, how far you've got, and a stale warning. */
@Composable
fun ReviewGuideHeader(
  guide: RemoteReviewGuide,
  stale: Boolean,
  visited: Int,
  canRewrite: Boolean,
  modifier: Modifier = Modifier,
  overview: @Composable (String) -> Unit = { BodyText(it) },
  onRewrite: () -> Unit,
) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    if (stale) {
      Banner(
        "The changes moved on since this guide was written.", tone = Tone.Warning,
        actionLabel = if (canRewrite) "Rewrite" else null, onAction = if (canRewrite) onRewrite else null,
      )
    }
    if (guide.overview.isNotEmpty()) overview(guide.overview)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      LinearProgressIndicator(
        progress = { visited.toFloat() / guide.stops.size.coerceAtLeast(1) },
        Modifier.widthIn(max = 160.dp).weight(1f, fill = false),
        color = theme.accent, trackColor = theme.bgTertiary, drawStopIndicator = {},
      )
      MutedText("$visited of ${DiffReviewPrompt.plural(guide.stops.size, "stop")} read")
    }
  }
}

/** A stop in the guide's list: its number, title and what kind of stop it is. */
@Composable
fun ReviewGuideStopRow(index: Int, stop: RemoteReviewGuideStop, visited: Boolean, modifier: Modifier = Modifier, comments: Int = 0) {
  val theme = ArgusTheme.colors
  Row(
    modifier.fillMaxWidth().semantics(mergeDescendants = true) { stateDescription = if (visited) "Read" else "Not read" },
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Box(
      Modifier.padding(top = 1.dp).size(18.dp).background(if (visited) theme.accent else theme.bgTertiary, CircleShape),
      contentAlignment = Alignment.Center,
    ) {
      if (visited) Icon(Icons.check, null, Modifier.size(11.dp), tint = theme.bg)
      else Text("${index + 1}", color = theme.textMuted, style = argusFont(10, FontWeight.SemiBold))
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
      Text(stop.title, color = theme.text, style = argusFont(13, FontWeight.Medium), maxLines = 2)
      FlowRow(spacing = 6.dp, rowSpacing = 4.dp, packed = true) {
        MutedText(DiffReviewPrompt.plural(stop.paths.size, "file"))
        if (stop.mechanical) Badge("Mechanical")
        if (stop.lookClosely.isNotEmpty()) Badge("Look closely", tone = Tone.Warning)
        if (comments > 0) Badge(DiffReviewPrompt.plural(comments, "comment"), tone = Tone.Accent)
      }
    }
  }
}

/** No guide yet, one being written, or one that failed, and the button that writes it. */
@Composable
fun ReviewGuidePlaceholder(state: RemoteReviewGuideState?, error: String?, canWrite: Boolean, modifier: Modifier = Modifier, onWrite: () -> Unit) {
  when {
    state?.status == RemoteReviewGuideStateStatus.generating ->
      Column(modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Loading("Claude is reading the changes")
        MutedText("A guide takes a minute or two. You can leave and come back.")
      }
    state?.status == RemoteReviewGuideStateStatus.failed ->
      EmptyState(Icons.warning, "Couldn't write a guide", modifier, body = state.error ?: error, selectable = true) {
        if (canWrite) Btn("Try Again", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icons.refresh, onClick = onWrite)
      }
    state == null && error != null -> EmptyState(Icons.warning, "Couldn't load the guide", modifier, body = error, selectable = true)
    state == null -> Loading("Loading guide", modifier)
    else ->
      EmptyState(
        Icons.guide, "Review guide", modifier,
        body = "Claude reads the changes and writes a tour of them: where to start, what to read closely, and what's mechanical.",
      ) {
        if (canWrite) Btn("Write a Guide", small = true, hugs = true, icon = Icons.guide, onClick = onWrite)
      }
  }
}
