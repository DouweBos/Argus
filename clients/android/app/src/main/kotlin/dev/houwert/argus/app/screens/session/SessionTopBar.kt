package dev.houwert.argus.app.screens.session

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A pushed screen's top bar: back, a title with the line under it saying where, and actions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionTopBar(title: String, subtitle: String?, onBack: () -> Unit, actions: @Composable RowScope.() -> Unit = {}) {
  val theme = ArgusTheme.colors
  TopAppBar(
    title = {
      Column(Modifier.semantics(mergeDescendants = true) { heading() }) {
        Text(title, color = theme.text, style = argusFont(16, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (subtitle != null) {
          Text(subtitle, color = theme.textSecondary, style = argusFont(12), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
    },
    navigationIcon = { IconBtn(Icon.arrowBack, "Back", onClick = onBack) },
    actions = actions,
    colors = TopAppBarDefaults.topAppBarColors(containerColor = theme.bg, scrolledContainerColor = theme.bg),
    // The app scaffold already pads for the status bar.
    windowInsets = WindowInsets(0, 0, 0, 0),
  )
}
