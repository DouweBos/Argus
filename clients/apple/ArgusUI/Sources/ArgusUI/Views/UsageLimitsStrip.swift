import ArgusCore
import SwiftUI

/// The Usage screen's plan limits, small: a group per Claude account and per
/// runner (named when there are several), each window a line with a thin bar.
public struct UsageLimitsStrip: View {
  @Environment(\.theme) private var theme
  let limits: ArgusProtocol.ClaudeUsageLimits?

  public init(limits: ArgusProtocol.ClaudeUsageLimits?) {
    self.limits = limits
  }

  /// Groups with limits to show; empty renders nothing.
  public static func groups(_ limits: ArgusProtocol.ClaudeUsageLimits?) -> [UsageLimitGroup] {
    UsageLimitFormat.groups(limits)
  }

  public var body: some View {
    let groups = Self.groups(limits)
    TimelineView(.periodic(from: .now, by: 30)) { context in
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 24, alignment: .top)], alignment: .leading, spacing: 14) {
        ForEach(groups) { group in
          VStack(alignment: .leading, spacing: 8) {
            if groups.count > 1 {
              Text(group.label)
                .font(.scaled(size: 11, weight: .medium))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
            }
            ForEach(group.windows, id: \.id) { UsageMeterLine(window: $0, now: context.date) }
          }
        }
      }
    }
  }
}

/// One plan window as a single line: label, reset, what's left, and a thin bar.
public struct UsageMeterLine: View {
  @Environment(\.theme) private var theme
  let window: ArgusProtocol.UsageLimitWindow
  let now: Date

  public init(window: ArgusProtocol.UsageLimitWindow, now: Date) {
    self.window = window
    self.now = now
  }

  public var body: some View {
    let left = UsageLimitFormat.percentLeft(usedPercent: window.usedPercent)
    let tone: Tone =
      switch UsageLimitFormat.level(usedPercent: window.usedPercent) {
      case .normal: .accent
      case .warning: .warning
      case .critical: .danger
      }
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Text(window.label).foregroundStyle(theme.textMuted).lineLimit(1)
        if let reset = UsageLimitFormat.resetCaption(resetsAtMs: window.resetsAt, now: now) {
          Text("· \(reset.prefix(1).lowercased() + reset.dropFirst())")
            .foregroundStyle(theme.textMuted.opacity(0.7))
            .lineLimit(1)
        }
        Spacer(minLength: 4)
        Text("\(left)% left").monospacedDigit().foregroundStyle(tone == .accent ? theme.textSecondary : tone.color(theme))
      }
      .font(.scaled(size: 11))
      UsageBar(fraction: UsageLimitFormat.fraction(usedPercent: window.usedPercent), tone: tone)
    }
    .accessibilityElement(children: .combine)
  }
}
