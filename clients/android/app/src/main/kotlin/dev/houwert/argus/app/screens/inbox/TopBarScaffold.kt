package dev.houwert.argus.app.screens.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch
import dev.houwert.argus.ui.components.TitleBar
import dev.houwert.argus.app.screens.backAction

/**
 * A screen with a top app bar: back when it was pushed (not the root of the tab showing it),
 * its title, trailing actions, and pull to refresh around the body when [onRefresh] is set.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TopBarScaffold(
  title: String,
  modifier: Modifier = Modifier,
  onRefresh: (suspend () -> Unit)? = null,
  actions: @Composable RowScope.() -> Unit = {},
  content: @Composable () -> Unit,
) {
  Column(modifier.fillMaxSize().background(ArgusTheme.colors.bg)) {
    TitleBar(title, onBack = backAction(), actions = actions)
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
