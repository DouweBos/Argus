package dev.houwert.argus.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.settings.WorktreeCleanupFormat
import dev.houwert.argus.core.settings.WorktreeCleanupModel
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupEntry
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupPolicy
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsLayout
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.SettingsRowIcon
import dev.houwert.argus.ui.components.SettingsToggleRow
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** A cleanup knob that changed, for telemetry. */
enum class WorktreeCleanupField(val raw: String) { Enabled("enabled"), LandedDays("landed_days"), IdleDays("idle_days"), MaxSize("max_size") }

/**
 * Settings → Worktrees: the cleanup policy, then the dry run it implies — what goes, what stays
 * and why. Groups are emitted straight into the surrounding settings page.
 */
@Composable
fun WorktreeCleanupSettings(
  model: WorktreeCleanupModel,
  canEdit: Boolean = true,
  onChanged: (WorktreeCleanupField, String) -> Unit = { _, _ -> },
) {
  val preview by model.preview.collectAsState()
  val error by model.error.collectAsState()
  val cleaning by model.cleaning.collectAsState()
  val scope = rememberCoroutineScope()
  val policy = preview?.policy
  if (policy == null) {
    SettingsGroup(title = "Cleanup") {
      if (error != null) SettingsRow("Couldn't read the cleanup policy", description = error) else SettingsItem { Loading("Measuring worktrees") }
    }
    return
  }
  fun save(next: WorktreeCleanupPolicy, field: WorktreeCleanupField, value: String) {
    if (next == policy) return
    scope.launch { if (model.setPolicy(next)) onChanged(field, value) }
  }

  SettingsGroup(
    title = "Cleanup",
    footer = "Sessions with uncommitted changes, commits that aren't pushed or merged, or a running agent " +
      "are always kept. Branches stay; only the worktree on disk goes.",
  ) {
    SettingsToggleRow(
      "Clean up automatically", policy.enabled, { save(policy.copy(enabled = it), WorktreeCleanupField.Enabled, "$it") },
      description = "Every few hours, remove what's listed below and note it in Notifications.", enabled = canEdit,
    )
    DaysRow("After merging", "Once a session is merged, or its pull request merged or closed.", policy.landedDays, listOf(1, 3, 7, 14, 30), canEdit) {
      save(policy.copy(landedDays = it), WorktreeCleanupField.LandedDays, "$it")
    }
    DaysRow("When untouched", "No commits or agent activity for this long.", policy.idleDays, listOf(7, 14, 30, 60, 90), canEdit) {
      save(policy.copy(idleDays = it), WorktreeCleanupField.IdleDays, "$it")
    }
    SettingsRow("Disk limit", description = "Past this, the least recently used worktrees go first, even if they aren't stale yet.") {
      val sizes = WorktreeCleanupModel.withCurrent(listOf(25.0, 50.0, 100.0, 200.0, 500.0), policy.maxGb, 0.0)
      Picker("Disk limit", policy.maxGb, listOf(PickerOption(0.0, "No limit")) + sizes.map { PickerOption(it, "${it.toInt()} GB") }, canEdit) {
        save(policy.copy(maxGb = it), WorktreeCleanupField.MaxSize, "$it")
      }
    }
  }

  val removable = WorktreeCleanupModel.removable(preview)
  val kept = WorktreeCleanupModel.kept(preview)
  SettingsGroup(
    title = if (removable.isEmpty()) "Would be removed" else "Would be removed (${removable.size})",
    footer = WorktreeCleanupFormat.lastSweepLine(preview),
  ) {
    if (removable.isEmpty()) SettingsRow("Nothing to clean up", description = "No worktree matches the rules above right now.")
    removable.forEach { WorktreeCleanupRow(it) }
    SettingsRow(WorktreeCleanupFormat.summary(preview), description = WorktreeCleanupFormat.totalLine(preview)) {
      Btn(
        "Clean Up Now", tone = ButtonTone.Danger, small = true, hugs = true, icon = Icon.trash, busy = cleaning,
        enabled = canEdit && removable.isNotEmpty() && !cleaning,
      ) { scope.launch { model.cleanUpNow() } }
    }
  }
  if (kept.isNotEmpty()) {
    SettingsGroup(title = "Kept", footer = "These match the rules but hold work that isn't saved anywhere else.") {
      kept.forEach { WorktreeCleanupRow(it) }
    }
  }
}

@Composable
private fun DaysRow(title: String, description: String, current: Long, options: List<Int>, enabled: Boolean, onPick: (Long) -> Unit) {
  SettingsRow(title, description = description) {
    val days = WorktreeCleanupModel.withCurrent(options.map { it.toLong() }, current, 0L)
    Picker(title, current, listOf(PickerOption(0L, "Never")) + days.map { PickerOption(it, if (it == 1L) "After 1 day" else "After $it days") }, enabled, onPick)
  }
}

/** A menu picker that reads as plain text while the device can't edit. */
@Composable
private fun <T> Picker(title: String, value: T, options: List<PickerOption<T>>, enabled: Boolean, onPick: (T) -> Unit) {
  if (enabled) {
    MenuChip(title, value, options, onPick)
  } else {
    Text(options.firstOrNull { it.value == value }?.label ?: "$value", color = ArgusTheme.colors.textSecondary, style = argusFont(13))
  }
}

@Composable
fun WorktreeCleanupRow(entry: WorktreeCleanupEntry) {
  val theme = ArgusTheme.colors
  val name = entry.displayName ?: entry.branch
  val why = WorktreeCleanupFormat.why(entry)
  val size = entry.bytes?.let(WorktreeCleanupFormat::bytes) ?: "—"
  Row(
    Modifier.fillMaxWidth().padding(SettingsLayout.rowPadding).clearAndSetSemantics { contentDescription = "$name, ${entry.projectName}, $why, $size" },
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    SettingsRowIcon(if (entry.blockedBy == null) Icon.branch else Icon.lock)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(name, color = theme.text, style = argusFont(13, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(
        "${entry.projectName} · $why", color = if (entry.blockedBy == null) theme.textSecondary else theme.warning,
        style = argusFont(11.5f), maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
    }
    Text(size, color = theme.textSecondary, style = argusFont(12))
  }
}
