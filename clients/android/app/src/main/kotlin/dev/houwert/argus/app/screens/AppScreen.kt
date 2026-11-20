package dev.houwert.argus.app.screens

import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.navigation.NavBackStackEntry
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Router
import dev.houwert.argus.ui.components.TopBarScreen

/** A screen under the app bar; pushed screens get a back arrow, a tab's root doesn't. */
@Composable
fun AppScreen(title: String, actions: (@Composable RowScope.() -> Unit)? = null, content: @Composable () -> Unit) {
  TopBarScreen(title, onBack = backAction(), actions = actions, content = content)
}

/** Pop for a pushed screen; null at a tab's root, which has nowhere to go back to. */
@Composable
fun backAction(): (() -> Unit)? {
  val router = LocalRouter.current
  val entry = LocalViewModelStoreOwner.current as? NavBackStackEntry
  return if (entry != null && entry.destination.route != Router.ROOT) router::pop else null
}
