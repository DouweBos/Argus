import ArgusKit
import SwiftUI

/// One automation or teammate duty's next run: whose it is, when it fires and
/// what it is waiting on, like `AutomationRow`.
public struct UpcomingRunRow: View {
  @Environment(\.theme) private var theme
  let run: ArgusProtocol.UpcomingRun

  public init(run: ArgusProtocol.UpcomingRun) {
    self.run = run
  }

  public static func tone(_ run: ArgusProtocol.UpcomingRun) -> Tone {
    switch run.waiting {
    case nil: .success
    case .paused?: .muted
    default: .warning
    }
  }

  public var body: some View {
    HStack(spacing: 10) {
      Image(systemName: run.teammateId == nil ? Icon.automations : Icon.person)
        .foregroundStyle(theme.textSecondary)
        .frame(width: 22)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(run.name).lineLimit(1)
        Text("\(Labels.upcomingWhen(run)) · \(Labels.upcomingSubtitle(run))")
          .font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(1)
        if let wait = Labels.upcomingWaitLabel(run) {
          HStack(spacing: 5) {
            StatusDot(tone: Self.tone(run))
            Text(wait).lineLimit(2)
          }
          .font(.scaled(.footnote))
          .foregroundStyle(Self.tone(run).color(theme))
        }
      }
      Spacer(minLength: 0)
    }
  }
}
