package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.houwert.argus.ui.theme.ArgusTheme

/** A screen under a [TitleBar]: back when [onBack] is set, trailing [actions], then the content. */
@Composable
fun TopBarScreen(
  title: String,
  modifier: Modifier = Modifier,
  onBack: (() -> Unit)? = null,
  actions: (@Composable RowScope.() -> Unit)? = null,
  content: @Composable () -> Unit,
) {
  Column(modifier.fillMaxSize().background(ArgusTheme.colors.bg)) {
    TitleBar(title, onBack = onBack, actions = actions)
    Box(Modifier.weight(1f)) { content() }
  }
}
