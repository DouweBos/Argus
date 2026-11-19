package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * A screen under a top app bar: the title, a back arrow when [onBack] is set, and trailing
 * [actions]. The Android twin of a pushed view's inline navigation title.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TopBarScreen(
  title: String,
  modifier: Modifier = Modifier,
  onBack: (() -> Unit)? = null,
  actions: @Composable RowScope.() -> Unit = {},
  content: @Composable () -> Unit,
) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxSize().background(theme.bg)) {
    TopAppBar(
      title = { Text(title, style = ArgusTheme.typography.headline, maxLines = 1, overflow = TextOverflow.Ellipsis) },
      navigationIcon = {
        if (onBack != null) IconButton(onBack) { Icon(Icon.arrowBack, "Back") }
      },
      actions = actions,
      colors = TopAppBarDefaults.topAppBarColors(
        containerColor = theme.bg,
        titleContentColor = theme.text,
        navigationIconContentColor = theme.text,
        actionIconContentColor = theme.textSecondary,
      ),
      // The app scaffold already pads for the status bar.
      windowInsets = WindowInsets(0, 0, 0, 0),
    )
    Box(Modifier.weight(1f)) { content() }
  }
}
