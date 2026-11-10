import ArgusUI
import SwiftUI
import WidgetKit

/// Keeps the widgets' snapshot in step with the connected computer. Other
/// computers keep what they last wrote, so the widgets still cover them.
struct WidgetSync: ViewModifier {
  let app: AppStore
  let proposals: ProposalsStore?
  @Environment(\.scenePhase) private var scenePhase
  @State private var countedInstalls = false

  private var connected: Bool { app.identity != nil && app.host.connection == .ready }

  /// This computer's entry, dated in the past so only real changes differ;
  /// nil until the lists have loaded, so a fresh connection never blanks it.
  private var current: WidgetSnapshot.Host? {
    guard connected, let id = app.activeHostId, let identity = app.identity, identity.deviceId == id,
      app.host.recentAgentsLoaded, let proposals, proposals.loaded
    else { return nil }
    return WidgetSnapshot.Host(
      host: app.host, proposals: proposals.proposals, id: id, name: identity.label, now: .distantPast)
  }

  private var paired: Set<String> { Set(app.hosts.map(\.deviceId)) }

  func body(content: Content) -> some View {
    content
      // Home and Usage load these only while shown; the widgets need them from any tab.
      .liveRefresh(enabled: connected, every: .seconds(60)) {
        await app.host.loadRecentAgents()
        await app.host.loadUsageLimits()
      }
      .onChange(of: current) { _, host in
        guard let host else { return }
        write(host)
      }
      .onChange(of: paired) { _, paired in
        guard app.loaded, WidgetSnapshotStore.update({ $0.prune(paired: paired) }) else { return }
        WidgetCenter.shared.reloadAllTimelines()
      }
      .onChange(of: scenePhase, initial: true) { _, phase in
        guard phase == .active, !countedInstalls else { return }
        countedInstalls = true
        Task { await Self.countInstalls() }
      }
  }

  private func write(_ host: WidgetSnapshot.Host) {
    var host = host
    host.updatedAt = Date()
    // Plan limits load on their own clock; until they do, keep the last ones.
    if app.host.usageLimits == nil {
      host.usage = WidgetSnapshotStore.load().hosts.first { $0.id == host.id }?.usage ?? []
    }
    let paired = paired
    WidgetSnapshotStore.update { $0.upsert(host, paired: paired) }
    WidgetCenter.shared.reloadAllTimelines()
  }

  private static func countInstalls() async {
    let widgets = (try? await WidgetCenter.shared.currentConfigurations()) ?? []
    let controls = (try? await ControlCenter.shared.currentControls()) ?? []
    let count = { (kind: String) in widgets.count { $0.kind == kind } }
    Telemetry.capture(
      .widgetsInstalled(
        agents: count(WidgetKind.agents), inbox: count(WidgetKind.inbox), usage: count(WidgetKind.usage),
        controls: controls.count { $0.kind == WidgetKind.quickAgentControl }))
  }
}
