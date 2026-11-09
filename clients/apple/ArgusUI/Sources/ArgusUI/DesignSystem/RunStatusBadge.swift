import ArgusKit
import SwiftUI

/// A run's status badge, as wide as the widest status so a column of them lines up.
public struct RunStatusBadge: View {
  let status: RemoteAutomationRunStatus

  public init(_ status: RemoteAutomationRunStatus) {
    self.status = status
  }

  public var body: some View {
    ZStack(alignment: .leading) {
      ForEach(RemoteAutomationRunStatus.allLabels, id: \.self) { Badge(label: $0).hidden() }
      Badge(label: status.label, tone: status.tone)
    }
  }
}

extension RemoteAutomationRunStatus {
  static let allLabels = ["queued", "running", "succeeded", "failed", "skipped", "cancelled"]
    .map(AutomationText.runLabel)
}
