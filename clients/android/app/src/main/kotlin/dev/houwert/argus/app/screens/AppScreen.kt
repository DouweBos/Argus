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
fun AppScreen(title: String, actions: @Composable RowScope.() -> Unit = {}, content: @Composable () -> Unit) {
  val router = LocalRouter.current
  val entry = LocalViewModelStoreOwner.current as? NavBackStackEntry
  val pushed = entry != null && entry.destination.route != Router.ROOT
  TopBarScreen(title, onBack = if (pushed) router::pop else null, actions = actions, content = content)
}
