package dev.houwert.argus.app.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

/** One tab's stack: its section's root, then pushed routes carried as JSON. */
@Composable
fun TabHost(tab: AppSection, router: Router, modifier: Modifier = Modifier) {
  val controller = rememberNavController()
  DisposableEffect(tab, controller) {
    router.register(tab, controller)
    onDispose { router.unregister(tab, controller) }
  }
  NavHost(controller, startDestination = Router.ROOT, modifier = modifier) {
    composable(Router.ROOT) { RouteScreen(tab.root) }
    composable("${Router.PUSHED}/{${Router.ARG}}", arguments = listOf(navArgument(Router.ARG) { type = NavType.StringType })) { entry ->
      entry.arguments?.getString(Router.ARG)?.let(Route::decode)?.let { RouteScreen(it) }
    }
  }
}
