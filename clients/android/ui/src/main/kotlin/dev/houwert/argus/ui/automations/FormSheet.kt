package dev.houwert.argus.ui.automations

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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * A full-height bottom sheet holding a form: dismiss on the leading edge, the title, and the
 * confirming action on the trailing edge, over a scrolling body. Nothing in it saves until
 * [onConfirm].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FormSheet(
  title: String,
  onDismiss: () -> Unit,
  dismissLabel: String = "Cancel",
  confirmLabel: String? = null,
  confirmEnabled: Boolean = true,
  onConfirm: () -> Unit = {},
  /** The header's leading button; a swipe down always dismisses. */
  onCancel: () -> Unit = onDismiss,
  content: @Composable ColumnScope.() -> Unit,
) {
  val theme = ArgusTheme.colors
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = theme.bg,
    contentColor = theme.text,
  ) {
    FormSheetBody(title, onCancel, dismissLabel, confirmLabel, confirmEnabled, onConfirm, content)
  }
}

/** The sheet's insides, separate so the gallery can show one without a window. */
@Composable
fun FormSheetBody(
  title: String,
  onDismiss: () -> Unit,
  dismissLabel: String = "Cancel",
  confirmLabel: String? = null,
  confirmEnabled: Boolean = true,
  onConfirm: () -> Unit = {},
  content: @Composable ColumnScope.() -> Unit,
) {
  val theme = ArgusTheme.colors
  Column(Modifier.navigationBarsPadding().imePadding()) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(48.dp)) {
      AccentLink(dismissLabel, Modifier.align(Alignment.CenterStart), size = 16, onClick = onDismiss)
      Text(
        title, Modifier.align(Alignment.Center).padding(horizontal = 88.dp).semantics { heading() },
        color = theme.text, style = ArgusTheme.typography.headline, maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
      if (confirmLabel != null) {
        AccentLink(confirmLabel, Modifier.align(Alignment.CenterEnd), enabled = confirmEnabled, size = 16, onClick = onConfirm)
      }
    }
    Column(
      Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(ArgusMetrics.space),
      verticalArrangement = Arrangement.spacedBy(ArgusMetrics.space),
      content = content,
    )
  }
}
