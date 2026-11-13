import ArgusCore
import SwiftUI

/// What is left of the plan an agent's runner draws on, as compact meter
/// lines: every Claude account for Claude Code, else the runner's own windows.
public struct AgentUsageLimits: View {
  @Environment(\.theme) private var theme
  let groups: [UsageLimitGroup]

  public init(groups: [UsageLimitGroup]) {
    self.groups = groups
  }

  public var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { context in
      VStack(alignment: .leading, spacing: 10) {
        ForEach(groups) { group in
          VStack(alignment: .leading, spacing: 7) {
            if groups.count > 1 {
              Text(group.label)
                .font(.scaled(size: 11, weight: .medium))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
            }
            ForEach(group.windows, id: \.id) { window in
              UsageMeterLine(window: window, now: context.date)
                .help(Self.help(window, now: context.date))
            }
          }
        }
      }
    }
  }

  /// "Session · Resets in 2h 12m · Under pace", for a hover.
  public static func help(_ window: ArgusProtocol.UsageLimitWindow, now: Date) -> String {
    [
      window.label,
      "\(UsageLimitFormat.percentLeft(usedPercent: window.usedPercent))% left",
      UsageLimitFormat.resetCaption(resetsAtMs: window.resetsAt, now: now),
      UsageLimitFormat.paceCaption(window.pace),
    ]
    .compactMap(\.self)
    .joined(separator: " · ")
  }
}

extension HostStore {
  /// Reads plan limits when nothing has yet, without skipping the host's cache.
  public func loadUsageLimitsIfMissing() async {
    guard usageLimits == nil, connection == .ready else { return }
    await loadUsageLimits()
  }
}
