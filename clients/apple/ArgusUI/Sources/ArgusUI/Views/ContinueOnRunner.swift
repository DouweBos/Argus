import ArgusCore
import SwiftUI

extension EnvironmentValues {
  /// Puts an agent a "Continue on…" just started in front; set by each app's screen.
  @Entry public var openContinuedAgent: ((RemoteAgentStatus) -> Void)?
}

/// "Continue on" as a submenu of an agent's menu: every installed runner but
/// the agent's own. Empty when there's nowhere to go or it's mid-turn.
public struct ContinueOnMenu: View {
  @Environment(HostStore.self) private var host
  let agentId: String
  let onContinued: (RemoteAgentStatus) -> Void
  let onError: (String) -> Void

  public init(
    agentId: String, onContinued: @escaping (RemoteAgentStatus) -> Void, onError: @escaping (String) -> Void
  ) {
    self.agentId = agentId
    self.onContinued = onContinued
    self.onError = onError
  }

  public var body: some View {
    let runners = host.continueRunners(agentId: agentId)
    if host.hasControl, !runners.isEmpty {
      Menu {
        ForEach(runners, id: \.id) { runner in
          Button(runner.displayName) { start(runner.id) }
        }
      } label: {
        Label("Continue on", systemImage: Icon.continueOn)
      }
      .disabled(!host.canContinueElsewhere(agentId: agentId))
    }
  }

  private func start(_ runnerId: String) {
    Task {
      do {
        onContinued(try await host.continueOnRunner(agentId: agentId, runnerId: runnerId, source: .menu))
      } catch {
        onError(HostStore.describe(error))
      }
    }
  }
}

/// Where a chat moved from one runner to another, at the top of the new chat.
public struct HandoffDivider: View {
  @Environment(\.theme) private var theme
  let handoff: RemoteMessageHandoff

  public init(handoff: RemoteMessageHandoff) {
    self.handoff = handoff
  }

  public var body: some View {
    HStack(spacing: 10) {
      rule
      Label {
        Text("Continued on \(handoff.toRunner) from \(handoff.fromRunner)")
      } icon: {
        Image(systemName: Icon.continueOn)
      }
      .font(.scaled(size: 12, weight: .medium))
      .foregroundStyle(theme.textMuted)
      .lineLimit(1)
      .layoutPriority(1)
      rule
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }

  private var rule: some View {
    Rectangle().fill(theme.border).frame(height: 1).frame(maxWidth: .infinity)
  }
}
