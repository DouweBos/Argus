package dev.houwert.argus.app.widgets

import android.content.Context
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import dev.houwert.argus.app.stores.AppStore
import dev.houwert.argus.core.stores.loadRecentAgents
import dev.houwert.argus.core.stores.widgetHost
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.push.SealedNotification
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps the widgets' snapshot in step with the connected computer. Other computers
 * keep what they last wrote, so the widgets still cover them.
 */
class WidgetSync(private val context: Context, private val app: AppStore) {
  fun start() {
    val host = app.host
    countInstalls()
    app.scope.launch {
      combine(host.connection, host.recentAgentsLoaded, host.recentAgents, app.identity, app.activeHostId) { connection, loaded, _, identity, active ->
        // Nothing until the list has loaded, so a fresh connection never blanks the widget.
        if (connection != Transport.State.Ready || !loaded || identity == null || identity.deviceId != active) null
        else host.widgetHost(identity.deviceId, identity.label, now = 0)
      }.distinctUntilChanged().collect { entry -> entry?.let { write(it.copy(updatedAt = System.currentTimeMillis())) } }
    }
    app.scope.launch {
      app.pairedHosts.map { hosts -> hosts.map { it.deviceId }.toSet() }.distinctUntilChanged().collect { paired ->
        if (app.loaded.value && WidgetStore.update(context) { it.prune(paired) }) AgentsWidget().updateAll(context)
      }
    }
    // Home loads recent agents only while shown; the widget needs them from any screen.
    app.scope.launch {
      ProcessLifecycleOwner.get().lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        while (true) {
          if (host.connection.value == Transport.State.Ready) runCatching { host.loadRecentAgents() }
          delay(60_000)
        }
      }
    }
  }

  private suspend fun write(entry: dev.houwert.argus.kit.widgets.WidgetSnapshot.Host) {
    val paired = app.pairedHosts.value.map { it.deviceId }.toSet()
    // Plan limits and proposals load on their own clocks; until their stores fill them, keep what was there.
    WidgetStore.update(context) { snapshot ->
      val previous = snapshot.hosts.firstOrNull { it.id == entry.id }
      val merged = if (previous != null && entry.usage.isEmpty() && entry.proposals.isEmpty()) {
        entry.copy(usage = previous.usage, proposals = previous.proposals, proposalCount = previous.proposalCount)
      } else entry
      snapshot.upsert(merged, paired + entry.id)
    }
    AgentsWidget().updateAll(context)
  }

  /** Once a launch, so the catalog can tell whether anyone places the widget. */
  private fun countInstalls() {
    val manager = android.appwidget.AppWidgetManager.getInstance(context)
    val agents = manager.getAppWidgetIds(android.content.ComponentName(context, AgentsWidgetReceiver::class.java)).size
    Telemetry.capture(TelemetryEvent.WidgetsInstalled(agents = agents, inbox = 0, usage = 0))
  }

  /** A push arrived, maybe with the app not running: flag or clear its agent now. */
  suspend fun pushReceived(notification: SealedNotification) {
    if (WidgetStore.update(context) { it.apply(notification.kind, notification.agentId) }) AgentsWidget().updateAll(context)
  }
}
