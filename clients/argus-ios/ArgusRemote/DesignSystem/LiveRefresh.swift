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

extension View {
  func liveRefresh(
    enabled: Bool, every interval: Duration = .seconds(4), _ action: @escaping () async -> Void
  ) -> some View {
    modifier(LiveRefresh(enabled: enabled, interval: interval, action: action))
  }
}
