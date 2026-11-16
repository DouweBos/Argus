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
      Menu {
        ForEach(destinations) { destination in
          Menu(destination.project.name) {
            Button(Self.newSession, systemImage: Icon.plus) { move(repoRoot: destination.project.repoRoot) }
            if !destination.sessions.isEmpty {
              Divider()
              ForEach(destination.sessions, id: \.id) { session in
                Button(SessionActivity.title(session)) { move(sessionId: session.id) }
              }
            }
          }
        }
      } label: {
        Label("Move to", systemImage: Icon.moveChat)
      }
      .disabled(!host.canContinueElsewhere(agentId: agentId))
    }
  }

  #if os(macOS)
    private static let newSession = "New Session"
  #else
    private static let newSession = "New session"
  #endif

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
