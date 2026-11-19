package dev.houwert.argus.app.navigation

import android.net.Uri
import androidx.navigation.NavHostController
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Navigation state, owned by the root so a notification can drive it from
 * outside the screen tree. Each tab keeps its own stack (its own NavHost), as
 * users expect when switching back to a tab. One navigation per user action.
 */
class Router {
  private val _section = MutableStateFlow(AppSection.Home)
  val section: StateFlow<AppSection> = _section.asStateFlow()

  private val controllers = mutableMapOf<AppSection, NavHostController>()
  /** Pushes asked for before a tab's NavHost was composed, replayed when it registers. */
  private val pending = mutableMapOf<AppSection, MutableList<Route>>()

  /** Called by each tab's NavHost as it is composed. */
  internal fun register(tab: AppSection, controller: NavHostController) {
    controllers[tab] = controller
    pending.remove(tab)?.forEach { navigate(controller, it) }
  }

  internal fun unregister(tab: AppSection, controller: NavHostController) {
    if (controllers[tab] === controller) controllers.remove(tab)
  }

  /** Push onto the current tab's stack. */
  fun push(route: Route) = push(route, _section.value)

  private fun push(route: Route, tab: AppSection) {
    val controller = controllers[tab]
    if (controller == null) pending.getOrPut(tab) { mutableListOf() } += route else navigate(controller, route)
  }

  fun pop() {
    controllers[_section.value]?.popBackStack()
  }

  /** Swap the top [count] screens for one, so back skips a finished flow. */
  fun replaceTop(route: Route, count: Int) {
    val controller = controllers[_section.value] ?: return
    repeat(count) { controller.popBackStack() }
    navigate(controller, route)
  }

  fun popToRoot() {
    val controller = controllers[_section.value] ?: return
    controller.popBackStack(ROOT, inclusive = false)
  }

  /** Select a tab; reselecting the current one returns it to its root. */
  fun selectTab(tab: AppSection) {
    if (tab == _section.value) popToRoot() else _section.value = tab
  }

  /** Open a section at its root; one without a tab opens inside More, so back lands on More's list. */
  fun show(section: AppSection) {
    val tab = section.tab
    _section.value = tab
    controllers[tab]?.popBackStack(ROOT, inclusive = false)
    if (tab != section) push(section.root, tab)
  }

  /** Switch section and open something: a notification tap, a deep link. */
  fun open(route: Route, section: AppSection) {
    if (route == section.root) return show(section)
    show(section)
    push(route, section.tab)
  }

  /** The screen on top of what's showing. */
  val frontRoute: Route?
    get() {
      val entry = controllers[_section.value]?.currentBackStackEntry ?: return null
      return entry.arguments?.getString(ARG)?.let(Route::decode)
    }

  private fun navigate(controller: NavHostController, route: Route) {
    controller.navigate("$PUSHED/${Uri.encode(Route.encode(route))}")
  }

  companion object {
    internal const val ROOT = "root"
    internal const val PUSHED = "route"
    internal const val ARG = "r"
  }
}
