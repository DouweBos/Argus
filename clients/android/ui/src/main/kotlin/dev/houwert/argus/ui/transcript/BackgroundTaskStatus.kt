package dev.houwert.argus.ui.transcript

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTask
import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTaskStatus
import dev.houwert.argus.ui.components.ChromeText
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

object BackgroundTaskText {
  /** "Running · 4m 12s", "Done in 18m 41s", "Failed after 3s", "Stopped after 1m 0s". */
  fun label(task: RemoteBackgroundTask, nowMillis: Double): String = when (task.status) {
    RemoteBackgroundTaskStatus.running -> "Running · ${ChromeText.duration((nowMillis - task.startedAt) / 1000)}"
    RemoteBackgroundTaskStatus.completed -> "Done in ${took(task)}"
    RemoteBackgroundTaskStatus.failed -> "Failed after ${took(task)}"
    else -> "Stopped after ${took(task)}"
  }

  private fun took(task: RemoteBackgroundTask) = ChromeText.duration((task.durationMs ?: 0.0) / 1000)
}

/** How a call launched with `run_in_background` is getting on: a live timer while it runs, then how long it took. */
@Composable
fun BackgroundTaskStatus(task: RemoteBackgroundTask, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val running = task.status == RemoteBackgroundTaskStatus.running
  val now = rememberNow(running)
  val color = when (task.status) {
    RemoteBackgroundTaskStatus.running -> theme.accent
    RemoteBackgroundTaskStatus.failed -> theme.error
    else -> theme.textMuted
  }
  Text(
    BackgroundTaskText.label(task, now), modifier, color = color,
    style = argusFont(11).copy(fontFeatureSettings = "tnum"), maxLines = 1, softWrap = false,
  )
}
