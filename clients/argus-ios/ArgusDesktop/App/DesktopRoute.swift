import Foundation

/// Which screen the window shows — the single source of truth, mirroring
/// `docs/routing.md`. Views read it; navigation goes through `DesktopModel.navigate`.
enum DesktopRoute: Hashable {
  case home
  /// `/sessions/:sessionId/agents`, optionally focused on one agent tab.
  case session(id: String, agentId: String?)

  var sessionId: String? {
    if case .session(let id, _) = self { return id }
    return nil
  }

  var agentId: String? {
    if case .session(_, let agentId) = self { return agentId }
    return nil
  }

  /// The route pattern, never the ids — what telemetry may see.
  var pattern: String {
    switch self {
    case .home: "/"
    case .session: "/sessions/:sessionId/agents"
    }
  }
}
