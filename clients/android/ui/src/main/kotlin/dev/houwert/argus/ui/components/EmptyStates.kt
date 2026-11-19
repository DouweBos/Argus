package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * A pane with nothing to show, centred in all the room it's given (`ContentUnavailableView`).
 * `selectable` lets an error worth copying be selected.
 */
@Composable
fun EmptyState(
  icon: ImageVector,
  title: String,
  modifier: Modifier = Modifier,
  body: String? = null,
  selectable: Boolean = false,
  actions: (@Composable ColumnScope.() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  Box(modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
    Column(
      Modifier.widthIn(max = 360.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Icon(icon, null, Modifier.size(44.dp).padding(bottom = 4.dp), tint = theme.textSecondary)
      Text(title, color = theme.text, style = argusFont(20, FontWeight.Bold), textAlign = TextAlign.Center)
      if (body != null) {
        val text = @Composable { Text(body, color = theme.textSecondary, style = argusFont(15), textAlign = TextAlign.Center) }
        if (selectable) SelectionContainer { text() } else text()
      }
      if (actions != null) {
        Column(
          Modifier.padding(top = 8.dp),
          horizontalAlignment = Alignment.CenterHorizontally,
          verticalArrangement = Arrangement.spacedBy(8.dp),
          content = actions,
        )
      }
    }
  }
}

/** A quiet "nothing here": a small muted icon over a line or two, centred. */
@Composable
fun QuietEmptyState(
  icon: ImageVector,
  title: String,
  modifier: Modifier = Modifier,
  message: String? = null,
  actions: (@Composable ColumnScope.() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  Box(modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
    Column(
      Modifier.widthIn(max = 300.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Icon(icon, null, Modifier.size(22.dp).padding(bottom = 2.dp), tint = theme.textMuted)
      Text(title, color = theme.textSecondary, style = argusFont(13, FontWeight.Medium), textAlign = TextAlign.Center)
      if (message != null) {
        SelectionContainer {
          Text(message, color = theme.textMuted, style = argusFont(12), textAlign = TextAlign.Center)
        }
      }
      if (actions != null) Column(Modifier.padding(top = 4.dp), content = actions)
    }
  }
}

/** A spinner over a line saying what's loading. */
@Composable
fun Loading(label: String, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Column(
    modifier.fillMaxWidth().padding(vertical = 28.dp).semantics(mergeDescendants = true) { contentDescription = label },
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    CircularProgressIndicator(Modifier.size(20.dp), color = theme.textMuted, strokeWidth = 2.dp)
    Text(label, color = theme.textSecondary, style = ArgusTheme.typography.subheadline, textAlign = TextAlign.Center)
  }
}

/**
 * A list that loads: `content` once it has rows, a centred spinner before the first answer,
 * the error with a retry when that failed, and `empty` only once a load came back with nothing.
 * Rows on screen always win, so a refresh behind them never flashes anything. The three inputs
 * are `LoadPhase(loaded:error:isEmpty:)`'s.
 */
@Composable
fun LoadPhaseBox(
  loaded: Boolean,
  error: String?,
  isEmpty: Boolean,
  modifier: Modifier = Modifier,
  loadingLabel: String = "Loading",
  failedTitle: String = "Couldn't load this",
  onRetry: (() -> Unit)? = null,
  empty: @Composable () -> Unit,
  content: @Composable () -> Unit,
) {
  Box(modifier) {
    when {
      !isEmpty -> content()
      error != null ->
        EmptyState(Icon.warning, failedTitle, body = error, selectable = true) {
          if (onRetry != null) Btn("Retry", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.refresh, onClick = onRetry)
        }
      !loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Loading(loadingLabel) }
      else -> empty()
    }
  }
}
