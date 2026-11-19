package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** One choice in a [PickerSheet] or [MenuChip]; `disabled` ones show, with a hint saying why. */
data class PickerOption<T>(val value: T, val label: String, val hint: String? = null, val disabled: Boolean = false)

/**
 * A bottom sheet of options. Single-select closes on tap; multi-select stays open so several
 * can be toggled in one go.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> PickerSheet(
  title: String,
  options: List<PickerOption<T>>,
  selected: Set<T>,
  onPick: (T) -> Unit,
  onDismiss: () -> Unit,
  multi: Boolean = false,
  emptyMessage: String? = null,
) {
  val theme = ArgusTheme.colors
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(),
    containerColor = theme.bg,
    contentColor = theme.text,
  ) {
    Column(Modifier.navigationBarsPadding()) {
      Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(44.dp), contentAlignment = Alignment.Center) {
        Text(title, color = theme.text, style = ArgusTheme.typography.headline)
        AccentLink("Done", Modifier.align(Alignment.CenterEnd), size = 17, onClick = onDismiss)
      }
      if (options.isEmpty()) {
        Box(Modifier.fillMaxWidth().heightIn(min = 240.dp)) {
          EmptyState(Icon.search, title, body = emptyMessage ?: "Nothing to choose from yet.")
        }
      } else {
        LazyColumn(Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp)) {
          item {
            ListSection {
              for (option in options) {
                val interaction = rememberInteraction()
                Row(
                  Modifier.fillMaxWidth()
                    .alpha(if (option.disabled) 0.5f else 1f)
                    .argusClickable(interaction, !option.disabled, role = if (multi) Role.Checkbox else Role.RadioButton) {
                      onPick(option.value)
                      if (!multi) onDismiss()
                    }
                    .padding(horizontal = 16.dp, vertical = 11.dp),
                  verticalAlignment = Alignment.CenterVertically,
                  horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                  Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(option.label, color = theme.text, style = argusFont(15))
                    if (!option.hint.isNullOrEmpty()) {
                      Text(option.hint, color = theme.textMuted, style = argusFont(12), maxLines = 2)
                    }
                  }
                  if (option.value in selected) {
                    Icon(Icon.check, "Selected", Modifier.size(18.dp), tint = theme.accent)
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

