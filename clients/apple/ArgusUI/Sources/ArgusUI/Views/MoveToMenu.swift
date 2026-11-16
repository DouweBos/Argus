import ArgusCore
import SwiftUI

/// "Move to" as a submenu of an agent's menu: each project, then a new session
/// or one of its sessions. The chat goes on there and this agent stops.
public struct MoveToMenu: View {
  @Environment(HostStore.self) private var host
  let agentId: String
  let onMoved: (HostStore.MovedChat) -> Void
  let onError: (String) -> Void

  public init(
    agentId: String, onMoved: @escaping (HostStore.MovedChat) -> Void, onError: @escaping (String) -> Void
  ) {
    self.agentId = agentId
    self.onMoved = onMoved
    self.onError = onError
  }

  public var body: some View {
    let destinations = host.moveDestinations(agentId: agentId)
    if host.hasControl, !destinations.isEmpty {
      MoveToItems(
        destinations: destinations.map { destination in
          .init(
            repoRoot: destination.project.repoRoot, name: destination.project.name,
            sessions: destination.sessions.map { .init(id: $0.id, title: SessionActivity.title($0)) })
        },
        enabled: host.canContinueElsewhere(agentId: agentId), move: move
      )
      .equatable()
    }
  }

  private func move(sessionId: String? = nil, repoRoot: String? = nil) {
    Task {
      do {
        onMoved(try await host.transferAgent(agentId: agentId, sessionId: sessionId, repoRoot: repoRoot))
      } catch {
        onError(HostStore.describe(error))
      }
    }
  }
}

/// The submenu itself, rebuilt only when what it shows changes: rebuilding an
/// open submenu (on every streamed status) closes and reopens it.
private struct MoveToItems: View, Equatable {
  struct Session: Equatable { let id: String, title: String }
  struct Destination: Equatable {
    let repoRoot: String, name: String
    let sessions: [Session]
  }
  let destinations: [Destination]
  let enabled: Bool
  let move: (_ sessionId: String?, _ repoRoot: String?) -> Void

  var body: some View {
    Menu {
      ForEach(destinations, id: \.repoRoot) { destination in
        Menu(destination.name) {
          Button(Self.newSession, systemImage: Icon.plus) { move(nil, destination.repoRoot) }
          if !destination.sessions.isEmpty {
            Divider()
            ForEach(destination.sessions, id: \.id) { session in
              Button(session.title) { move(session.id, nil) }
            }
          }
        }
      }
    } label: {
      Label("Move to", systemImage: Icon.moveChat)
    }
    .disabled(!enabled)
  }

  nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.destinations == rhs.destinations && lhs.enabled == rhs.enabled
  }

  #if os(macOS)
    private static let newSession = "New Session"
  #else
    private static let newSession = "New session"
  #endif
}
