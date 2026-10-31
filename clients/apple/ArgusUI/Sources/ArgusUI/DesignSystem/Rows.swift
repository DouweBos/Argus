import ArgusKit
import SwiftUI

extension RemoteAgentState {
  public var tone: Tone {
    switch self {
    case .running: .accent
    case .requiresAction: .warning
    case .error: .danger
    case .stopped: .success
    case .idle: .muted
    }
  }
}

public struct AgentRow: View {
  @Environment(\.theme) private var theme
  let name: String
  var status: RemoteAgentState
  var attention: String?
  var model: String?
  var meta: String?

  public init(
    name: String,
    status: RemoteAgentState,
    attention: String? = nil,
    model: String? = nil,
    meta: String? = nil
  ) {
    self.name = name
    self.status = status
    self.attention = attention
    self.model = model
    self.meta = meta
  }

  public var body: some View {
    HStack(spacing: 10) {
      // An agent waiting on you gets a steady warning dot, not a pulse —
      // the pulse means "busy", and this one is the opposite.
      StatusDot(
        tone: attention != nil ? .warning : status.tone,
        pulse: attention == nil && status == .running)
      VStack(alignment: .leading, spacing: 2) {
        Text(name).lineLimit(1)
        if let subtitle {
          Text(subtitle).font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(1)
        }
      }
      Spacer(minLength: 6)
      if let attention {
        Badge(label: attention, tone: .warning)
      }
    }
  }

  private var subtitle: String? {
    [meta, model].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
      .nilIfEmpty
  }
}

public struct StoppedAgentRow: View {
  let agent: RemoteStoppedAgent
  /// Off when the row already sits under the session that names the branch.
  var showBranch = true

  public init(agent: RemoteStoppedAgent, showBranch: Bool = true) {
    self.agent = agent
    self.showBranch = showBranch
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Label(agent.title, systemImage: Icon.history).lineLimit(1)
      HStack(spacing: 6) {
        Text(
          "\(Labels.timeAgo(agent.endedAt)) · \(agent.messageCount) messages"
            + (showBranch ? " · \(agent.branch)" : "")
        )
        .font(.scaled(.footnote))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        if agent.isImported {
          Badge(label: "Imported").accessibilityLabel("Imported from Claude Code")
        }
      }
    }
  }
}

public struct AutomationRow: View {
  let automation: RemoteAutomation
  let lastRun: RemoteAutomationRunStatus?
  /// When the latest run started, in epoch millis.
  let lastRunAt: Double?

  public init(automation: RemoteAutomation, lastRun: RemoteAutomationRunStatus? = nil, lastRunAt: Double? = nil) {
    self.automation = automation
    self.lastRun = lastRun
    self.lastRunAt = lastRunAt
  }

  /// The latest run's outcome, as the Mac's last-run badge shows it.
  static func dotTone(_ automation: RemoteAutomation, lastRun: RemoteAutomationRunStatus?) -> Tone {
    if automation.running { return .accent }
    if let lastRun { return lastRun.tone }
    return automation.enabled ? .success : .muted
  }

  public var body: some View {
    HStack(spacing: 10) {
      StatusDot(
        tone: Self.dotTone(automation, lastRun: lastRun), pulse: automation.running,
        accessibilityLabel: lastRun.map { "Last run \($0.label)" })
      VStack(alignment: .leading, spacing: 2) {
        Text(automation.name).lineLimit(1)
        Text("\(Labels.triggerLabel(automation)) · \(state)")
          .font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer(minLength: 6)
      if let lastRunAt {
        Text(Labels.timeAgo(lastRunAt))
          .font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(1)
      }
    }
  }

  /// A paused automation can still be run by hand, so it says "paused" rather
  /// than "off".
  private var state: String {
    if automation.running { return "running" }
    if !automation.enabled { return "paused" }
    return Labels.until(automation.nextRunAt).map { "next \($0)" } ?? "enabled"
  }
}

public struct RunRow: View {
  @Environment(\.theme) private var theme
  let run: RemoteAutomationRun
  var showName = false

  public init(run: RemoteAutomationRun, showName: Bool = false) {
    self.run = run
    self.showName = showName
  }

  public var body: some View {
    HStack(spacing: 10) {
      if run.unreadReport {
        Circle().fill(theme.accent).frame(width: 6, height: 6)
      }
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Badge(label: run.status.label, tone: run.status.tone)
          if showName {
            Text(run.automationName).lineLimit(1)
          }
        }
        Text("\(Labels.timeAgo(run.startedAt)) · \(run.triggerReason)")
          .font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(1)
        if let error = run.error, !error.isEmpty {
          Text(error).font(.scaled(.footnote)).foregroundStyle(theme.error).lineLimit(2)
        }
      }
      Spacer(minLength: 6)
      Text(Labels.runDuration(run))
        .font(.scaled(size: 11, design: .monospaced))
        .foregroundStyle(.secondary)
    }
  }
}

extension String {
  public var nilIfEmpty: String? { isEmpty ? nil : self }
}
