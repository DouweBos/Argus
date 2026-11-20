package dev.houwert.argus.app.platform

import android.content.Intent
import dev.houwert.argus.app.navigation.AppSection
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.navigation.RouteHints
import dev.houwert.argus.app.navigation.RouteLink
import dev.houwert.argus.app.navigation.Router
import dev.houwert.argus.app.navigation.open
import dev.houwert.argus.app.notifications.Notifier
import dev.houwert.argus.app.stores.AppStore
import dev.houwert.argus.core.routing.ArgusLocation
import dev.houwert.argus.core.routing.ArgusRoute
import dev.houwert.argus.kit.push.NotificationExtra
import dev.houwert.argus.kit.widgets.WidgetLink
import kotlinx.coroutines.launch

/**
 * Turns a tapped notification, an `argus://` link, a widget or a shortcut into the
 * screen it names. Something that lands while the app is locked, or before the
 * screen tree exists, is parked and replayed once it can be shown.
 */
class LaunchRouter(private val app: AppStore) {
  /** Where an opened screen came from, for telemetry. */
  enum class Source(val wire: String) { Link("link"), Notification("notification"), Shortcut("shortcut"), Widget("widget"), Share("share") }

  private sealed interface Pending {
    data class Agent(val id: String, val label: String) : Pending
    data class Link(val location: ArgusLocation, val via: Source) : Pending
    data class NewAgent(val via: Source) : Pending
  }

  private var router: Router? = null
  /** Set by the activity: shared images are read through it while its grant lasts. */
  var resolver: android.content.ContentResolver? = null
  private var unlocked = false
  private var pending: Pending? = null
  /** Telemetry for each opened link; the app wires it to its catalog. */
  var opened: (pattern: String, via: Source, fallback: Boolean) -> Unit = { _, _, _ -> }

  fun attach(router: Router) {
    this.router = router
    replay()
  }

  fun detach(router: Router) {
    if (this.router === router) this.router = null
  }

  fun unlocked() {
    unlocked = true
    replay()
  }

  private val ready: Boolean get() = unlocked && router != null

  /** True when the intent was one of ours. */
  fun handle(intent: Intent?): Boolean {
    intent ?: return false
    when (intent.action) {
      Notifier.ACTION_OPEN_NOTIFICATION -> {
        val agentId = intent.getStringExtra(NotificationExtra.AGENT_ID) ?: return true
        openAgent(agentId, intent.getStringExtra(NotificationExtra.LABEL) ?: "Agent")
      }
      ACTION_NEW_AGENT -> openNewAgent(Source.Shortcut)
      Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> {
        val resolver = resolver ?: return false
        app.scope.launch { if (ShareIntake.receive(intent, resolver) != null) openNewAgent(Source.Share) }
      }
      Intent.ACTION_VIEW -> {
        val url = intent.dataString ?: return false
        val via = when (WidgetLink.source(url)) {
          null -> if (intent.getBooleanExtra(EXTRA_FROM_SHORTCUT, false)) Source.Shortcut else Source.Link
          else -> Source.Widget
        }
        if (WidgetLink.isNewAgent(url)) return true.also { openNewAgent(via) }
        val location = ArgusLocation.fromDeepLink(url) ?: return false
        open(location, via)
      }
      else -> return false
    }
    return true
  }

  fun open(location: ArgusLocation, via: Source) {
    if (!ready) return run { pending = Pending.Link(location, via) }
    if (app.pairedHosts.value.isEmpty()) return app.host.showError("Pair a computer before opening Argus links.")
    val hostId = location.host?.let { id -> app.pairedHosts.value.firstOrNull { it.deviceId == id }?.deviceId }
    open(location.route, hostId, RouteHints(), via)
  }

  /** The new-agent composer on the last active project. */
  fun openNewAgent(via: Source) {
    val router = router
    if (!ready || router == null) return run { pending = Pending.NewAgent(via) }
    if (app.pairedHosts.value.isEmpty()) return app.host.showError("Pair a computer before starting an agent.")
    opened("/sessions/new", via, false)
    router.open(Route.NewSession(), AppSection.Home)
  }

  private fun open(route: ArgusRoute, hostId: String?, hints: RouteHints, via: Source) {
    val router = router ?: return
    app.scope.launch {
      if (hostId != null && hostId != app.activeHostId.value) app.selectHost(hostId)
      val destination = RouteLink.resolve(route, app.host, hints)
      opened(route.pattern, via, destination.isFallback)
      router.open(destination)
    }
  }

  private fun openAgent(agentId: String, label: String) {
    val router = router
    if (!ready || router == null) return run { pending = Pending.Agent(agentId, label) }
    // Repeated alerts for the same agent shouldn't stack copies of its screen.
    if ((router.frontRoute as? Route.Agent)?.id == agentId) return
    app.scope.launch {
      // The alert may be from a computer this phone isn't connected to: switch to its owner first.
      val owner = app.hostId(agentId)
      if (owner != null && owner != app.activeHostId.value) app.selectHost(owner)
      opened("/sessions/:sessionId/agents", Source.Notification, false)
      // An agent belongs under Home, whatever section was last on screen.
      router.open(Route.Agent(agentId, label), AppSection.Home)
    }
  }

  private fun replay() {
    if (!ready) return
    val parked = pending ?: return
    pending = null
    when (parked) {
      is Pending.Agent -> openAgent(parked.id, parked.label)
      is Pending.Link -> open(parked.location, parked.via)
      is Pending.NewAgent -> openNewAgent(parked.via)
    }
  }

  companion object {
    const val ACTION_NEW_AGENT = "dev.houwert.argus.NEW_AGENT"
    const val EXTRA_FROM_SHORTCUT = "fromShortcut"
  }
}
