import ArgusCore
import SwiftUI

/// "Session usage  12%" for a list row: the share of the current session window used.
public struct SessionUsageRow: View {
  let window: ArgusProtocol.UsageLimitWindow

  public init(window: ArgusProtocol.UsageLimitWindow) {
    self.window = window
  }

  public var body: some View {
    LabeledContent("Session usage") { SessionUsagePercent(window: window) }
  }
}

/// "12%" used of a plan window, warning-toned as it fills.
public struct SessionUsagePercent: View {
  @Environment(\.theme) private var theme
  let window: ArgusProtocol.UsageLimitWindow

  public init(window: ArgusProtocol.UsageLimitWindow) {
    self.window = window
  }

  public var body: some View {
    Text("\(UsageLimitFormat.percentUsed(usedPercent: window.usedPercent))%")
      .monospacedDigit()
      .foregroundStyle(tone)
  }

  private var tone: Color {
    switch UsageLimitFormat.level(usedPercent: window.usedPercent) {
    case .critical: theme.error
    case .warning: theme.warning
    case .normal: theme.textSecondary
    }
  }
}
