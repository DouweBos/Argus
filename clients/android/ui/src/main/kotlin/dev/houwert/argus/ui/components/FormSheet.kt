package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * A short form in a bottom sheet: Cancel, the title, and the confirming action across the top, as
 * a sheet's navigation bar on iOS. [confirmLabel] null leaves only Cancel.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FormSheet(
  title: String,
  onDismiss: () -> Unit,
  confirmLabel: String? = null,
  confirmEnabled: Boolean = true,
  onConfirm: () -> Unit = {},
  cancelLabel: String = "Cancel",
  content: @Composable ColumnScope.() -> Unit,
) {
  val theme = ArgusTheme.colors
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = theme.bg,
    contentColor = theme.text,
  ) {
    Column(Modifier.navigationBarsPadding().imePadding()) {
      Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(44.dp), contentAlignment = Alignment.Center) {
        AccentLink(cancelLabel, Modifier.align(Alignment.CenterStart), size = 17, onClick = onDismiss)
        Text(title, Modifier.semantics { heading() }, color = theme.text, style = ArgusTheme.typography.headline)
        if (confirmLabel != null) {
          AccentLink(confirmLabel, Modifier.align(Alignment.CenterEnd), enabled = confirmEnabled, size = 17, onClick = onConfirm)
        }
      }
      Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(ArgusMetrics.space),
        verticalArrangement = Arrangement.spacedBy(ArgusMetrics.space),
        content = content,
      )
    }
  }
}
