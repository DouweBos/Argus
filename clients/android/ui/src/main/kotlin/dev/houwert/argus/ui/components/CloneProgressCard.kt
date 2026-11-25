package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.projects.CloneRepositoryModel
import dev.houwert.argus.kit.protocol.generated.CloneJob
import dev.houwert.argus.kit.protocol.generated.CloneStatus
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A clone as it runs, fails or is cancelled: the repository, where it lands, its phase and one bar. */
@Composable
fun CloneProgressCard(job: CloneJob, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Card(modifier) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(job.url, color = theme.text, style = argusFont(16, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(job.path, color = theme.textSecondary, style = argusFont(12, mono = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      when (job.status) {
        CloneStatus.running -> {
          val fraction = CloneRepositoryModel.overallFraction(job)
          if (fraction != null && job.percent != null) {
            LinearProgressIndicator(
              progress = { fraction }, Modifier.fillMaxWidth(),
              color = theme.accent, trackColor = theme.bgTertiary, drawStopIndicator = {},
            )
          } else {
            LinearProgressIndicator(Modifier.fillMaxWidth(), color = theme.accent, trackColor = theme.bgTertiary)
          }
          MutedText(CloneRepositoryModel.progressLabel(job))
        }
        CloneStatus.failed -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(ArgusIcon.warning, null, Modifier.size(16.dp), tint = theme.error)
          Text(job.error ?: "The clone failed.", color = theme.error, style = argusFont(14))
        }
        CloneStatus.cancelled -> MutedText("Cancelled. Nothing was left behind.")
        else -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(ArgusIcon.check, null, Modifier.size(16.dp), tint = theme.success)
          Text("Cloned and added as a project", color = theme.success, style = argusFont(14))
        }
      }
    }
  }
}
