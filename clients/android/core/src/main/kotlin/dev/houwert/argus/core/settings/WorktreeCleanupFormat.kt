package dev.houwert.argus.core.settings

import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupEntry
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupGuard
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupReason
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupPreview
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupSweepTrigger
import java.util.Locale
import kotlin.math.abs

/** The words around a worktree cleanup: sizes, ages, why each worktree goes or stays. */
object WorktreeCleanupFormat {
  /** Decimal units, as a file size reads on the computer. */
  fun bytes(value: Double): String {
    if (value < 1000) return "${value.toLong()} bytes"
    val units = listOf("KB", "MB", "GB", "TB")
    var size = value / 1000
    var unit = 0
    while (size >= 1000 && unit < units.lastIndex) {
      size /= 1000
      unit++
    }
    val text = if (size >= 100 || unit == 0) "%.0f".format(Locale.US, size) else "%.1f".format(Locale.US, size)
    return "${text.removeSuffix(".0")} ${units[unit]}"
  }

  fun relative(ms: Double, now: Long = System.currentTimeMillis()): String {
    val seconds = (now - ms) / 1000
    val past = seconds >= 0
    val s = abs(seconds)
    val (n, unit) = when {
      s < 60 -> return "just now"
      s < 3600 -> (s / 60).toInt() to "minute"
      s < 86_400 -> (s / 3600).toInt() to "hour"
      s < 86_400 * 30 -> (s / 86_400).toInt() to "day"
      s < 86_400 * 365 -> (s / (86_400 * 30)).toInt() to "month"
      else -> (s / (86_400 * 365)).toInt() to "year"
    }
    val phrase = "$n $unit${if (n == 1) "" else "s"}"
    return if (past) "$phrase ago" else "in $phrase"
  }

  fun why(entry: WorktreeCleanupEntry, now: Long = System.currentTimeMillis()): String {
    entry.blockedBy?.let {
      return when (it) {
        WorktreeCleanupGuard.agentRunning -> "an agent is running"
        WorktreeCleanupGuard.uncommitted -> "uncommitted changes"
        WorktreeCleanupGuard.unpushed -> "commits not pushed or merged"
        else -> "couldn't read its git state"
      }
    }
    return when (entry.reason) {
      WorktreeCleanupReason.landed -> "merged ${relative(entry.landedAt ?: entry.lastActivityAt, now)}"
      WorktreeCleanupReason.overCap -> "over the disk limit, last used ${relative(entry.lastActivityAt, now)}"
      else -> "untouched since ${relative(entry.lastActivityAt, now)}"
    }
  }

  fun summary(preview: WorktreeCleanupPreview?): String {
    val n = WorktreeCleanupModel.removable(preview).size
    return if (n == 0) "Nothing to reclaim" else "$n worktree${plural(n)}, ${bytes(WorktreeCleanupModel.reclaimableBytes(preview))}"
  }

  fun totalLine(preview: WorktreeCleanupPreview?): String? =
    preview?.totalBytes?.takeIf { it > 0 }?.let { "Worktrees take ${bytes(it)} in all." }

  fun lastSweepLine(preview: WorktreeCleanupPreview?, now: Long = System.currentTimeMillis()): String? {
    val sweep = preview?.lastSweep ?: return null
    val n = sweep.removed.size
    val what = if (n == 0) "removed nothing" else "removed $n worktree${plural(n)} and freed ${bytes(sweep.freedBytes)}"
    val kind = if (sweep.trigger == WorktreeCleanupSweepTrigger.scheduled) "Last automatic cleanup" else "Last cleanup"
    return "$kind ${relative(sweep.at, now)} $what."
  }

  private fun plural(n: Int) = if (n == 1) "" else "s"
}
