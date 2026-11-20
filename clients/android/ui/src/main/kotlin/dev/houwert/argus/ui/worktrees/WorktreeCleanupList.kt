package dev.houwert.argus.ui.worktrees

import android.text.format.DateUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.WorktreeCleanupModel
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupEntry
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupGuard
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupPreview
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupReason
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupSweepTrigger
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsLayout
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.SettingsRowIcon
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import java.util.Locale

/** The dry run: one row per worktree with its reclaimable size, then the ones a guard keeps, then Clean up now and the last sweep. */
@Composable
fun WorktreeCleanupList(preview: WorktreeCleanupPreview, cleaning: Boolean, canRun: Boolean, onCleanUp: () -> Unit) {
  val removable = WorktreeCleanupModel.removable(preview)
  val kept = WorktreeCleanupModel.kept(preview)
  val now = System.currentTimeMillis().toDouble()
  SettingsGroup(
    title = if (removable.isEmpty()) "Would be removed" else "Would be removed (${removable.size})",
    footer = WorktreeCleanupFormat.lastSweep(preview, now),
  ) {
    if (removable.isEmpty()) {
      SettingsRow("Nothing to clean up", description = "No worktree matches the rules above right now.")
    } else {
      removable.forEach { WorktreeCleanupRow(it, now) }
    }
    SettingsRow(WorktreeCleanupFormat.summary(preview), description = WorktreeCleanupFormat.total(preview)) {
      Btn(
        "Clean up now", tone = ButtonTone.Danger, small = true, hugs = true, icon = Icon.trash, busy = cleaning,
        enabled = canRun && removable.isNotEmpty() && !cleaning, onClick = onCleanUp,
      )
    }
  }
  if (kept.isNotEmpty()) {
    SettingsGroup(title = "Kept", footer = "These match the rules but hold work that isn't saved anywhere else.") {
      kept.forEach { WorktreeCleanupRow(it, now) }
    }
  }
}

@Composable
fun WorktreeCleanupRow(entry: WorktreeCleanupEntry, nowMillis: Double = System.currentTimeMillis().toDouble()) {
  val theme = ArgusTheme.colors
  val name = entry.displayName ?: entry.branch
  val why = "${entry.projectName} · ${WorktreeCleanupFormat.why(entry, nowMillis)}"
  val size = entry.bytes?.let(WorktreeCleanupFormat::bytes) ?: "—"
  Row(
    Modifier.fillMaxWidth().padding(SettingsLayout.rowPadding).clearAndSetSemantics { contentDescription = "$name, $why, $size" },
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    SettingsRowIcon(if (entry.blockedBy == null) Icon.branch else Icon.lock)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(name, color = theme.text, style = argusFont(13, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(
        why, color = if (entry.blockedBy == null) theme.textSecondary else theme.warning, style = argusFont(11.5f), maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
    Text(size, color = theme.textSecondary, style = argusFont(12))
  }
}

object WorktreeCleanupFormat {
  /** Decimal units, like a file manager: "2.1 GB", "800 MB". */
  fun bytes(value: Double): String {
    val units = listOf("bytes", "KB", "MB", "GB", "TB")
    var amount = value
    var unit = 0
    while (amount >= 1000 && unit < units.size - 1) {
      amount /= 1000
      unit += 1
    }
    return when {
      unit == 0 -> "${amount.toLong()} bytes"
      unit >= 3 -> String.format(Locale.getDefault(), "%.1f %s", amount, units[unit])
      else -> "${Math.round(amount)} ${units[unit]}"
    }
  }

  fun relative(ms: Double, nowMillis: Double): String =
    DateUtils.getRelativeTimeSpanString(ms.toLong(), nowMillis.toLong(), DateUtils.MINUTE_IN_MILLIS).toString().lowercase(Locale.getDefault())

  fun why(entry: WorktreeCleanupEntry, nowMillis: Double): String {
    entry.blockedBy?.let { guard ->
      return when (guard) {
        WorktreeCleanupGuard.agentRunning -> "an agent is running"
        WorktreeCleanupGuard.uncommitted -> "uncommitted changes"
        WorktreeCleanupGuard.unpushed -> "commits not pushed or merged"
        else -> "couldn't read its git state"
      }
    }
    return when (entry.reason) {
      WorktreeCleanupReason.landed -> "merged ${relative(entry.landedAt ?: entry.lastActivityAt, nowMillis)}"
      WorktreeCleanupReason.overCap -> "over the disk limit, last used ${relative(entry.lastActivityAt, nowMillis)}"
      else -> "untouched since ${relative(entry.lastActivityAt, nowMillis)}"
    }
  }

  fun summary(preview: WorktreeCleanupPreview): String {
    val n = WorktreeCleanupModel.removable(preview).size
    return if (n == 0) "Nothing to reclaim" else "$n worktree${if (n == 1) "" else "s"}, ${bytes(WorktreeCleanupModel.reclaimableBytes(preview))}"
  }

  fun total(preview: WorktreeCleanupPreview): String? =
    preview.totalBytes.takeIf { it > 0 }?.let { "Worktrees take ${bytes(it)} in all." }

  fun lastSweep(preview: WorktreeCleanupPreview, nowMillis: Double): String? {
    val sweep = preview.lastSweep ?: return null
    val n = sweep.removed.size
    val what = if (n == 0) "removed nothing" else "removed $n worktree${if (n == 1) "" else "s"} and freed ${bytes(sweep.freedBytes)}"
    val kind = if (sweep.trigger == WorktreeCleanupSweepTrigger.scheduled) "Last automatic cleanup" else "Last cleanup"
    return "$kind ${relative(sweep.at, nowMillis)} $what."
  }
}
