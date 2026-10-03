import AppKit
import ArgusCore
import SwiftUI

/// Handoff with the phone: advertises the session on screen, and opens one the
/// phone hands over. Nothing is withdrawn when the window loses focus —
/// switching away is exactly when the handoff is wanted.
struct HandoffActivity: ViewModifier {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @State private var hostKey: String?

  func body(content: Content) -> some View {
    content
      .userActivity(Handoff.activityType, isActive: handoff != nil) { activity in
        guard let handoff else { return }
        activity.title = handoff.label
        activity.addUserInfoEntries(from: handoff.userInfo)
        activity.needsSave = true
      }
      .onContinueUserActivity(Handoff.activityType) { activity in
        // A phone paired with two computers hands off from either; only the
        // one that owns the session knows what the id means.
        guard let handoff = Handoff(userInfo: activity.userInfo) else { return }
        let matched = hostKey.map { handoff.hostKey == $0 } ?? false
        MacTelemetry.capture(.handoffContinued(matched: matched))
        guard matched else { return }
        model.navigate(.session(id: handoff.sessionId, agentId: handoff.agentId))
      }
      .task(id: store.connection == .ready) {
        guard hostKey == nil, let backend = model.backend else { return }
        hostKey = try? await backend.request(ArgusProtocol.Commands.RemoteGetHostKey.self, .init())
      }
  }

  private var handoff: Handoff? {
    guard let hostKey, let id = model.route.sessionId,
      let session = store.sessionsByRepo.values.joined().first(where: { $0.id == id })
    else { return nil }
    return Handoff(
      hostKey: hostKey, sessionId: id, agentId: model.route.agentId,
      label: session.displayName ?? session.branch,
      projectName: URL(fileURLWithPath: session.repoRoot).lastPathComponent,
      repoRoot: session.repoRoot)
  }
}
