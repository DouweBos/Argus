package dev.houwert.argus.app.screens.issues

import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.style.TextOverflow
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme

/** The Issues, issue and design screens' bar: back, a title, and actions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IntegrationTopBar(title: String, actions: @Composable RowScope.() -> Unit = {}) {
  val theme = ArgusTheme.colors
  val router = LocalRouter.current
  TopAppBar(
    title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = ArgusTheme.typography.headline) },
    navigationIcon = { IconBtn(Icon.arrowBack, "Back", tint = theme.text) { router.pop() } },
    actions = actions,
    // The shell already pads for the status bar.
    windowInsets = WindowInsets(0),
    colors = TopAppBarDefaults.topAppBarColors(containerColor = theme.bg, titleContentColor = theme.text, actionIconContentColor = theme.textSecondary),
  )
}
