import SwiftUI

/// Poll while a screen is on-screen, and re-fetch the moment the app comes
/// back to the foreground.
///
/// Lists have no push channel — the gateway only pushes agent events,
/// permissions and notifications — so everything else is polled.
struct LiveRefresh: ViewModifier {
  @Environment(\.scenePhase) private var scenePhase
  let enabled: Bool
  var interval: Duration = .seconds(4)
  let action: () async -> Void

  func body(content: Content) -> some View {
    content
      .task(id: enabled) {
        guard enabled else { return }
        await action()
        while !Task.isCancelled {
          try? await Task.sleep(for: interval)
          guard !Task.isCancelled else { return }
          await action()
        }
      }
      .onChange(of: scenePhase) { _, phase in
        guard phase == .active, enabled else { return }
        Task { await action() }
      }
  }
}

/// Re-fetch whatever only ever arrives over the socket: once when the app
/// returns to the foreground, and again when a connection dropped by the lock
/// screen comes back, since a request sent mid-reconnect answers nothing.
struct ResumeTask: ViewModifier {
  @Environment(\.scenePhase) private var scenePhase
  let enabled: Bool
  let connected: Bool
  let action: () async -> Void

  func body(content: Content) -> some View {
    content
      .onChange(of: scenePhase) { previous, phase in
        guard phase == .active, previous != .active, enabled, connected else { return }
        Task { await action() }
      }
      .onChange(of: connected) { _, isConnected in
        guard isConnected, enabled else { return }
        Task { await action() }
      }
  }
}

extension View {
  func onResume(
    enabled: Bool = true, connected: Bool, _ action: @escaping () async -> Void
  ) -> some View {
    modifier(ResumeTask(enabled: enabled, connected: connected, action: action))
  }

  func liveRefresh(
    enabled: Bool, every interval: Duration = .seconds(4), _ action: @escaping () async -> Void
  ) -> some View {
    modifier(LiveRefresh(enabled: enabled, interval: interval, action: action))
  }
}
