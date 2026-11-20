package dev.houwert.argus.ui.worktrees

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import dev.houwert.argus.core.stores.WorktreeCleanupModel
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupPolicy
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.SettingsToggleRow
import kotlinx.coroutines.launch

/**
 * Settings → Worktrees → Cleanup: the policy, then the dry run it implies — what goes, what
 * stays and why. The caller loads [model]; `onChanged` hears the knob that changed, for telemetry.
 */
@Composable
fun WorktreeCleanupSettings(
  model: WorktreeCleanupModel,
  canEdit: Boolean = true,
  onChanged: (WorktreeCleanupField, String) -> Unit = { _, _ -> },
) {
  val scope = rememberCoroutineScope()
  val preview by model.preview.collectAsState()
  val error by model.error.collectAsState()
  val cleaning by model.cleaning.collectAsState()
  val current = preview
  when {
    current != null -> {
      WorktreeCleanupPolicyGroup(current.policy, canEdit) { next, field, value ->
        scope.launch { if (model.setPolicy(next)) onChanged(field, value) }
      }
      WorktreeCleanupList(current, cleaning, canEdit) { scope.launch { model.cleanUpNow() } }
    }
    error != null -> SettingsGroup(title = "Cleanup") { SettingsRow("Couldn't read the cleanup policy", description = error) }
    else -> SettingsGroup(title = "Cleanup") { SettingsItem { Loading("Measuring worktrees") } }
  }
}

enum class WorktreeCleanupField(val wire: String) { Enabled("enabled"), LandedDays("landed_days"), IdleDays("idle_days"), MaxSize("max_size") }

/** The policy's four knobs; each change hands back the whole next policy. */
@Composable
fun WorktreeCleanupPolicyGroup(
  policy: WorktreeCleanupPolicy,
  canEdit: Boolean,
  onChange: (WorktreeCleanupPolicy, WorktreeCleanupField, String) -> Unit,
) {
  SettingsGroup(
    title = "Cleanup",
    footer = "Sessions with uncommitted changes, commits that aren't pushed or merged, or a running agent are always kept. " +
      "Branches stay; only the worktree on disk goes.",
  ) {
    SettingsToggleRow(
      "Clean up automatically", policy.enabled,
      { if (it != policy.enabled) onChange(policy.copy(enabled = it), WorktreeCleanupField.Enabled, "$it") },
      description = "Every few hours, remove what's listed below and note it in Notifications.",
      enabled = canEdit,
    )
    DaysRow(
      "After merging", "Once a session is merged, or its pull request merged or closed.", policy.landedDays,
      listOf(1L, 3L, 7L, 14L, 30L), canEdit,
    ) { onChange(policy.copy(landedDays = it), WorktreeCleanupField.LandedDays, "$it") }
    DaysRow(
      "When untouched", "No commits or agent activity for this long.", policy.idleDays, listOf(7L, 14L, 30L, 60L, 90L), canEdit,
    ) { onChange(policy.copy(idleDays = it), WorktreeCleanupField.IdleDays, "$it") }
    val sizes = WorktreeCleanupOptions.withCurrent(listOf(25.0, 50.0, 100.0, 200.0, 500.0), policy.maxGb)
    SettingsRow("Disk limit", description = "Past this, the least recently used worktrees go first, even if they aren't stale yet.") {
      Picker(
        "Disk limit", policy.maxGb,
        listOf(PickerOption(0.0, "No limit")) + sizes.map { PickerOption(it, "${it.toInt()} GB") }, canEdit,
      ) { if (it != policy.maxGb) onChange(policy.copy(maxGb = it), WorktreeCleanupField.MaxSize, "$it") }
    }
  }
}

@Composable
private fun DaysRow(title: String, description: String, value: Long, options: List<Long>, canEdit: Boolean, onPick: (Long) -> Unit) {
  SettingsRow(title, description = description) {
    val days = WorktreeCleanupOptions.withCurrent(options.map { it.toDouble() }, value.toDouble()).map { it.toLong() }
    Picker(
      title, value, listOf(PickerOption(0L, "Never")) + days.map { PickerOption(it, if (it == 1L) "After 1 day" else "After $it days") },
      canEdit,
    ) { if (it != value) onPick(it) }
  }
}

@Composable
private fun <T> Picker(title: String, value: T, options: List<PickerOption<T>>, enabled: Boolean, onPick: (T) -> Unit) {
  // A monitor-only phone reads the choice but can't open the menu.
  MenuChip(title, value, options.map { it.copy(disabled = !enabled) }, onPick)
}

object WorktreeCleanupOptions {
  /** Keeps a value set elsewhere selectable instead of blanking the picker. */
  fun withCurrent(options: List<Double>, current: Double): List<Double> =
    if (current == 0.0 || current in options) options else (options + current).sorted()
}
