package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A toolbar action: an icon button, or a row in the overflow menu once there are more than [GitScaffold] shows. */
class BarAction(val label: String, val icon: ImageVector, val enabled: Boolean = true, val run: () -> Unit)

/**
 * A pushed git screen's chrome: a top app bar with back and the title, up to two actions
 * as icons and the rest in an overflow menu, and an optional bar pinned under the content.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GitScaffold(
  title: String,
  actions: List<BarAction> = emptyList(),
  bottomBar: @Composable () -> Unit = {},
  content: @Composable () -> Unit,
) {
  val theme = ArgusTheme.colors
  val router = LocalRouter.current
  Scaffold(
    containerColor = theme.bg,
    topBar = {
      TopAppBar(
        title = { Text(title, style = argusFont(17, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { IconBtn(Icons.arrowBack, "Back", tint = theme.text) { router.pop() } },
        actions = { BarActions(actions) },
        colors = TopAppBarDefaults.topAppBarColors(
          containerColor = theme.bg, titleContentColor = theme.text, actionIconContentColor = theme.text,
        ),
        windowInsets = androidx.compose.foundation.layout.WindowInsets(0),
      )
    },
    bottomBar = bottomBar,
    contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0),
  ) { padding ->
    Box(Modifier.fillMaxSize().padding(padding)) { content() }
  }
}

@Composable
private fun RowScope.BarActions(actions: List<BarAction>) {
  val theme = ArgusTheme.colors
  val inline = if (actions.size <= 2) actions else actions.take(1)
  val overflow = actions.drop(inline.size)
  for (action in inline) IconBtn(action.icon, action.label, tint = theme.text, enabled = action.enabled, onClick = action.run)
  if (overflow.isEmpty()) return
  var open by remember { mutableStateOf(false) }
  Column {
    IconBtn(Icons.ellipsis, "More actions", tint = theme.text) { open = true }
    DropdownMenu(open, { open = false }, containerColor = theme.surface) {
      for (action in overflow) {
        DropdownMenuItem(
          text = { Text(action.label, style = argusFont(15)) },
          leadingIcon = { Icon(action.icon, null, tint = theme.textSecondary) },
          enabled = action.enabled,
          onClick = {
            open = false
            action.run()
          },
        )
      }
    }
  }
}
