package dev.houwert.argus.ui.composer

import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.PickerSheet
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme

/** Which sheet the phone composer's pill row has open. */
enum class PhoneComposerPicker { Model, Mode, Effort, Project, SideQuestion }

/**
 * The pills along the composer's foot: model, effort and permission mode open a picker sheet;
 * linked projects and side questions open theirs, and the overflow drops a menu. They wrap rather
 * than ever cut one off.
 */
@Composable
fun PhoneComposerPills(composer: ComposerModel, modifier: Modifier = Modifier, onPick: (PhoneComposerPicker) -> Unit) {
  composer.observe()
  val enabled = composer.isEnabled
  val asked = composer.host.sideQuestionsByAgent.value[composer.agentId]?.size ?: 0
  val linked = composer.linkedProjects.value.size
  FlowRow(modifier, spacing = 2.dp, rowSpacing = 0.dp, packed = true) {
    val modelLabel = composer.modelLabel
    ComposerPillLabel(
      Icon.agent, "Model: $modelLabel", title = modelLabel.removePrefix("Claude "), chevron = false, enabled = enabled,
    ) { onPick(PhoneComposerPicker.Model) }
    if (composer.effortLevels.isNotEmpty()) {
      val effort = ComposerEffort.label(composer.effort)
      ComposerPillLabel(Icon.clock, "Effort: $effort", title = effort, chevron = false, enabled = enabled) {
        onPick(PhoneComposerPicker.Effort)
      }
    }
    val mode = composer.permissionMode
    ComposerPillLabel(
      Icon.lock, "Permission mode: ${ComposerPermissionMode.label(mode)}", title = ComposerPermissionMode.label(mode),
      accent = mode != dev.houwert.argus.kit.protocol.generated.RemotePermissionMode.auto, chevron = false, enabled = enabled,
    ) { onPick(PhoneComposerPicker.Mode) }
    ComposerPillLabel(
      Icon.link, if (linked == 0) "Link project" else "$linked linked", title = if (linked == 0) null else "$linked linked",
      accent = linked > 0, chevron = false, enabled = enabled,
    ) { onPick(PhoneComposerPicker.Project) }
    if (composer.hasConversation && composer.host.supportsSideQuestion(composer.agentId)) {
      ComposerPillLabel(
        Icon.sideQuestion, "Side question", title = if (asked == 0) null else "$asked", accent = asked > 0, chevron = false,
        enabled = enabled,
      ) { onPick(PhoneComposerPicker.SideQuestion) }
    }
    if (composer.offersAccounts) ComposerOverflowMenu(composer)
  }
}

/** The effort picker's value for "no level": the CLI default. */
private const val DEFAULT_EFFORT = ""

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhoneComposerPickerSheet(composer: ComposerModel, which: PhoneComposerPicker, onDismiss: () -> Unit) {
  composer.observe()
  when (which) {
    PhoneComposerPicker.Model -> PickerSheet(
      "Model",
      composer.models.map { PickerOption(it.value, it.displayName, it.description.ifEmpty { null }) },
      setOf(composer.pickedModel ?: "default"),
      { composer.setModel(it) }, onDismiss,
      emptyMessage = "No agent has reported its models yet.",
    )
    PhoneComposerPicker.Mode -> PickerSheet(
      "Permission mode",
      ComposerPermissionMode.order.map { PickerOption(it, ComposerPermissionMode.label(it), ComposerPermissionMode.description(it)) },
      setOf(composer.permissionMode),
      { composer.setPermissionMode(it) }, onDismiss,
    )
    PhoneComposerPicker.Effort -> PickerSheet(
      "Effort",
      (listOf(DEFAULT_EFFORT) + composer.effortLevels).map { PickerOption(it, ComposerEffort.label(it.ifEmpty { null })) },
      setOf(composer.effort ?: DEFAULT_EFFORT),
      { composer.setEffort(it.ifEmpty { null }) }, onDismiss,
    )
    PhoneComposerPicker.Project -> PickerSheet(
      "Linked projects",
      composer.linkableProjects.map { PickerOption(it.repoRoot, it.name, it.repoRoot) },
      composer.linkedProjects.value.toSet(),
      { composer.toggleLink(it) }, onDismiss,
      multi = true,
      emptyMessage = "No other projects",
    )
    PhoneComposerPicker.SideQuestion -> ModalBottomSheet(
      onDismissRequest = onDismiss,
      sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
      containerColor = ArgusTheme.colors.bg,
      contentColor = ArgusTheme.colors.text,
    ) {
      SideQuestionPanel(
        composer.host, composer.agentId, Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp).navigationBarsPadding(),
      ) { composer.onAffordance?.invoke(ChatInputAffordance.SideAnswerSent) }
    }
  }
}
