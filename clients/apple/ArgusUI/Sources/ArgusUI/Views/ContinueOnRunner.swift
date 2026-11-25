import ArgusCore
import SwiftUI

extension EnvironmentValues {
  /// Puts an agent a "Continue on" just started in front; set by each app's screen.
  @Entry public var openContinuedAgent: OpenContinuedAgentAction?
}

public struct OpenContinuedAgentAction {
  let handler: @MainActor (RemoteAgentStatus) -> Void

  public init(_ handler: @escaping @MainActor (RemoteAgentStatus) -> Void) {
    self.handler = handler
  }

  @MainActor public func callAsFunction(_ agent: RemoteAgentStatus) { handler(agent) }
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
      ContinueOnItems(
        runners: runners.map { .init(id: $0.id, name: $0.displayName) },
        enabled: host.canContinueElsewhere(agentId: agentId), start: start
      )
      .equatable()
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

/// The submenu itself, rebuilt only when what it shows changes: rebuilding an
/// open submenu (on every streamed status) closes and reopens it.
private struct ContinueOnItems: View, Equatable {
  struct Runner: Equatable { let id: String, name: String }
  let runners: [Runner]
  let enabled: Bool
  let start: (String) -> Void

  var body: some View {
    Menu {
      ForEach(runners, id: \.id) { runner in
        Button(runner.name) { start(runner.id) }
      }
    } label: {
      Label("Continue on", systemImage: Icon.continueOn)
    }
    .disabled(!enabled)
  }

  nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.runners == rhs.runners && lhs.enabled == rhs.enabled
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

/// Where a teammate was handed a finished duty run: a quiet divider with the
/// report one click away, then the teammate's own summary below it.
public struct DutyRunDivider: View {
  @Environment(\.theme) private var theme
  @Environment(\.openDutyRun) private var openDutyRun
  let dutyRun: RemoteMessageDutyRun

  public init(dutyRun: RemoteMessageDutyRun) {
    self.dutyRun = dutyRun
  }

  public var body: some View {
    HStack(spacing: 10) {
      rule
      Label {
        Text("\(dutyRun.automationName) \(dutyRun.failed ? "failed" : "finished")")
      } icon: {
        Image(systemName: dutyRun.failed ? "exclamationmark.triangle" : Icon.automations)
      }
      .font(.scaled(size: 12, weight: .medium))
      .foregroundStyle(dutyRun.failed ? theme.warning : theme.textMuted)
      .lineLimit(1)
      .layoutPriority(1)
      if let openDutyRun {
        Button("Open Report") { openDutyRun(dutyRun) }
          .buttonStyle(.argusBorderless)
          .font(.scaled(size: 12, weight: .medium))
          .foregroundStyle(theme.accent)
          .fixedSize()
      }
      rule
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .contain)
  }

  private var rule: some View {
    Rectangle().fill(theme.border).frame(height: 1).frame(maxWidth: .infinity)
  }
}

extension EnvironmentValues {
  /// Opens a duty run's report; each app routes it its own way.
  @Entry public var openDutyRun: ((RemoteMessageDutyRun) -> Void)? = nil
}
