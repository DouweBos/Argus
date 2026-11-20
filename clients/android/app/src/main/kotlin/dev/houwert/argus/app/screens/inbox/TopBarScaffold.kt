package dev.houwert.argus.app.screens.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch

/**
 * A screen with a top app bar: back when it was pushed (not the root of the tab showing it),
 * its title, trailing actions, and pull to refresh around the body when [onRefresh] is set.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TopBarScaffold(
  route: Route,
  title: String,
  modifier: Modifier = Modifier,
  onRefresh: (suspend () -> Unit)? = null,
  actions: @Composable RowScope.() -> Unit = {},
  content: @Composable () -> Unit,
) {
  val theme = ArgusTheme.colors
  val router = LocalRouter.current
  val section by router.section.collectAsState()
  val pushed = section.root != route
  Column(modifier.fillMaxSize().background(theme.bg)) {
    TopAppBar(
      title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = ArgusTheme.typography.headline) },
      navigationIcon = { if (pushed) IconBtn(Icon.arrowBack, "Back", tint = theme.text) { router.pop() } },
      actions = actions,
      // The shell already pads for the status bar.
      windowInsets = WindowInsets(0),
      colors = TopAppBarDefaults.topAppBarColors(
        containerColor = theme.bg, titleContentColor = theme.text, actionIconContentColor = theme.textSecondary,
        navigationIconContentColor = theme.text,
      ),
    )
    Box(Modifier.fillMaxWidth().weight(1f)) {
      if (onRefresh == null) {
        content()
      } else {
        val scope = rememberCoroutineScope()
        var refreshing by remember { mutableStateOf(false) }
        PullToRefreshBox(
          isRefreshing = refreshing,
          onRefresh = {
            refreshing = true
            scope.launch {
              try { onRefresh() } finally { refreshing = false }
            }
          },
          modifier = Modifier.fillMaxSize(),
        ) { content() }
      }
    }
  }
}
