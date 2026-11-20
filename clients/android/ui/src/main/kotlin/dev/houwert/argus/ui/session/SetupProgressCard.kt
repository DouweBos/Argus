package dev.houwert.argus.ui.session

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.sessions.SetupStep
import dev.houwert.argus.core.sessions.observeSetupProgress
import dev.houwert.argus.kit.protocol.fraction
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.theme.ArgusTheme

object SetupProgressText {
  private val phaseLabels =
    mapOf("matching" to "Matching files", "copy" to "Copying", "symlink" to "Linking", "command" to "Running setup commands")

  fun title(step: SetupStep?): String = step?.phase?.let { phaseLabels[it] } ?: "Initializing session"

  fun stepLine(step: SetupStep?): String {
    if (step == null || step.total <= 0) return "Preparing the worktree"
    val remaining = (step.total - step.current).toInt().coerceAtLeast(0)
    return "Step ${step.current.toInt()} of ${step.total.toInt()} · $remaining remaining"
  }

  fun fraction(step: SetupStep?, session: RemoteSession): Double? =
    if (step != null && step.total > 0) (step.current / step.total).coerceIn(0.0, 1.0) else session.progress?.fraction
}

/** Follows the host's setup broadcasts for [sessionId] while the caller is on screen. */
@Composable
fun rememberSetupStep(host: HostStore, sessionId: String): SetupStep? {
  var step by remember(sessionId) { mutableStateOf<SetupStep?>(null) }
  DisposableEffect(host, sessionId) {
    val stop = host.observeSetupProgress(sessionId) { step = it }
    onDispose { stop() }
  }
  return step
}

/** Which setup step is running and on what; [step] comes from [rememberSetupStep]. */
@Composable
fun SetupProgressCard(session: RemoteSession, step: SetupStep?, modifier: Modifier = Modifier) {
  ProgressCard(
    title = SetupProgressText.title(step),
    stepLine = SetupProgressText.stepLine(step),
    fraction = SetupProgressText.fraction(step, session),
    lines = listOfNotNull(step?.item, step?.detail),
    modifier = modifier,
  )
}

/** The layout setup and delete share: spinner and title, a bar, then what it's working on. */
@Composable
internal fun ProgressCard(title: String, stepLine: String, fraction: Double?, lines: List<String>, modifier: Modifier) {
  val theme = ArgusTheme.colors
  Card(modifier) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      CircularProgressIndicator(Modifier.size(14.dp), color = theme.textMuted, strokeWidth = 2.dp)
      Text(title, Modifier.weight(1f), style = ArgusTheme.typography.headline, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(stepLine, style = ArgusTheme.typography.caption, color = theme.textSecondary)
    }
    if (fraction != null) {
      LinearProgressIndicator(
        progress = { fraction.toFloat() },
        modifier = Modifier.fillMaxWidth(),
        color = theme.accent,
        trackColor = theme.bgTertiary,
      )
    } else {
      LinearProgressIndicator(Modifier.fillMaxWidth(), color = theme.accent, trackColor = theme.bgTertiary)
    }
    lines.forEach { MonoText(it, color = theme.textSecondary, maxLines = 1, truncateHead = true) }
  }
}
