package dev.houwert.argus.ui.compare

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.compare.CompareRuns
import dev.houwert.argus.core.compare.appRuns
import dev.houwert.argus.core.compare.isWorking
import dev.houwert.argus.core.compare.testRuns
import dev.houwert.argus.kit.protocol.generated.RemoteCompareRun
import dev.houwert.argus.kit.protocol.generated.RemoteCompareRunState
import dev.houwert.argus.kit.protocol.generated.RemoteCompareSlot
import dev.houwert.argus.kit.protocol.generated.RemoteCompareSlotAgentStatus
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import java.util.Locale

/**
 * One slot of a compare run: what it ran on, what it changed, how its runs and tests stand,
 * what it cost, and what its simulator or browser shows. `onKeep` null hides keeping.
 */
@Composable
fun CompareSlotCard(
  score: RemoteCompareSlot,
  runner: String,
  model: String?,
  onOpen: () -> Unit,
  onKeep: (() -> Unit)?,
  modifier: Modifier = Modifier,
  reviewComments: Int = 0,
  screenshot: ImageBitmap? = null,
  loadingScreenshot: Boolean = false,
  keeping: Boolean = false,
) {
  val theme = ArgusTheme.colors
  val status = CompareFormat.status(score.agentStatus)
  Card(modifier.semantics { contentDescription = runner + (model?.let { ", $it" } ?: "") }) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      StatusDot(status.second, pulse = score.isWorking, contentDescription = status.first)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(runner, color = theme.text, style = argusFont(14, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (model != null) Text(model, color = theme.textSecondary, style = argusFont(12), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      Badge(status.first, tone = status.second)
    }
    Screen(score.hasScreen, screenshot, loadingScreenshot)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Metric(Icon.changes, "Changes", CompareFormat.diff(score), null)
      Metric(Icon.play, "Run", CompareFormat.runs(score.appRuns), CompareFormat.tone(score.appRuns))
      Metric(Icon.check, "Tests", CompareFormat.runs(score.testRuns), CompareFormat.tone(score.testRuns))
      Metric(Icon.chat, "Review comments", "$reviewComments", if (reviewComments > 0) Tone.Warning else null)
      Metric(Icon.usage, "Cost", CompareFormat.cost(score.costUsd), null)
      Metric(Icon.agent, "Tokens", CompareFormat.tokens(score.tokens), null)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
      Btn("Open", tone = ButtonTone.Secondary, small = true, hugs = true, onClick = onOpen)
      Box(Modifier.weight(1f))
      if (onKeep != null) {
        Btn("Keep this one", small = true, hugs = true, icon = Icon.check, busy = keeping, enabled = !score.isWorking && !keeping, onClick = onKeep)
      }
    }
  }
}

@Composable
private fun Screen(hasScreen: Boolean, screenshot: ImageBitmap?, loading: Boolean) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  // Black only behind a picture: the muted placeholder vanishes on it in light mode.
  Box(
    Modifier.fillMaxWidth().height(220.dp).clip(shape).background(if (screenshot == null) theme.bgTertiary else theme.mediaBg),
    contentAlignment = Alignment.Center,
  ) {
    when {
      screenshot != null -> Image(screenshot, "Screenshot", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
      loading -> CircularProgressIndicator(Modifier.size(18.dp), color = theme.textMuted, strokeWidth = 2.dp)
      else ->
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Icon(Icon.simulator, null, Modifier.size(20.dp), tint = theme.textMuted)
          Text(if (hasScreen) "No screenshot" else "No simulator or browser", color = theme.textMuted, style = argusFont(11))
        }
    }
  }
}

@Composable
private fun Metric(icon: ImageVector, label: String, value: String, tone: Tone?) {
  val theme = ArgusTheme.colors
  Row(
    Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = "$label: $value" },
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.width(16.dp), contentAlignment = Alignment.Center) { Icon(icon, null, Modifier.size(13.dp), tint = theme.textMuted) }
    Text(label, Modifier.weight(1f), color = theme.textSecondary, style = argusFont(12))
    Text(value, color = tone?.color(theme) ?: theme.text, style = argusFont(12, FontWeight.Medium), maxLines = 1)
  }
}

/** How compare numbers read, shared by every place that shows them. */
object CompareFormat {
  fun cost(usd: Double): String = when {
    usd <= 0 -> "—"
    usd < 0.01 -> "<$0.01"
    else -> String.format(Locale.US, "$%.2f", usd)
  }

  fun tokens(count: Long): String = when {
    count <= 0 -> "—"
    count < 1_000 -> "$count"
    count < 1_000_000 -> String.format(Locale.US, "%.1fk", count / 1_000.0)
    else -> String.format(Locale.US, "%.1fM", count / 1_000_000.0)
  }

  fun label(state: RemoteCompareRunState): String = when (state) {
    RemoteCompareRunState.running -> "Running"
    RemoteCompareRunState.passed -> "Passed"
    else -> "Failed"
  }

  fun diff(score: RemoteCompareSlot): String {
    val diff = score.diff ?: return "—"
    return "${diff.files} files  +${diff.insertions} −${diff.deletions}"
  }

  fun runs(runs: List<RemoteCompareRun>): String {
    val state = CompareRuns.summary(runs) ?: return "Not run"
    return if (runs.size > 1) "${label(state)} (${runs.size})" else label(state)
  }

  fun tone(runs: List<RemoteCompareRun>): Tone? = when (CompareRuns.summary(runs)) {
    RemoteCompareRunState.failed -> Tone.Danger
    RemoteCompareRunState.passed -> Tone.Success
    RemoteCompareRunState.running -> Tone.Accent
    else -> null
  }

  /** The slot's agent as a word and a tone; no agent yet is still setting up. */
  fun status(status: RemoteCompareSlotAgentStatus?): Pair<String, Tone> = when {
    status == null -> "Setting up" to Tone.Accent
    status == RemoteCompareSlotAgentStatus.running -> "Working" to Tone.Accent
    status == RemoteCompareSlotAgentStatus.requiresAction -> "Needs you" to Tone.Warning
    status == RemoteCompareSlotAgentStatus.error -> "Failed" to Tone.Danger
    status == RemoteCompareSlotAgentStatus.stopped -> "Stopped" to Tone.Muted
    else -> "Done" to Tone.Success
  }
}
