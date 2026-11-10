import ArgusCore
import SwiftUI

/// An automation's track record, stated plainly: an automation that is wrong
/// seven times out of ten should read as wrong. Shared by the Mac's automation
/// screen and the phone's.
public struct CalibrationStats: View {
  @Environment(\.theme) private var theme
  let calibration: ArgusProtocol.AutomationCalibration

  public init(_ calibration: ArgusProtocol.AutomationCalibration) {
    self.calibration = calibration
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      // Four across where they fit, two by two on a narrow phone.
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .top, spacing: 24) { stats }
        Grid(alignment: .topLeading, horizontalSpacing: 24, verticalSpacing: 12) {
          GridRow { acceptance; autoStarted }
          GridRow { waiting; merged }
        }
      }
      ForEach(Array(calibration.dismissals.enumerated()), id: \.offset) { _, dismissal in
        Label("\(dismissal.title) — \(dismissal.reason)", systemImage: "exclamationmark.triangle")
          .font(.scaled(size: 13))
          .foregroundStyle(theme.warning)
      }
    }
  }

  @ViewBuilder
  private var stats: some View {
    acceptance
    autoStarted
    waiting
    merged
  }

  private var acceptance: some View {
    stat(
      "Acceptance", calibration.acceptanceRate.map { "\(Int(($0 * 100).rounded()))%" } ?? "—",
      "\(Int(calibration.accepted + calibration.autoStarted + calibration.resolved)) kept · "
        + "\(Int(calibration.dismissed)) dismissed",
      poor: (calibration.acceptanceRate ?? 1) < 0.5)
  }

  private var autoStarted: some View { stat("Auto-started", "\(Int(calibration.autoStarted))") }
  private var waiting: some View { stat("Waiting", "\(Int(calibration.pending))") }
  private var merged: some View {
    stat("Merged", "\(Int(calibration.merged))", "\(Int(calibration.abandoned)) abandoned")
  }

  private func stat(_ label: String, _ value: String, _ delta: String? = nil, poor: Bool = false) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.scaled(.caption)).foregroundStyle(theme.textSecondary)
      Text(value).font(.scaled(.title3).weight(.semibold)).monospacedDigit().foregroundStyle(theme.text)
      if let delta {
        Text(delta).font(.scaled(.caption)).foregroundStyle(poor ? theme.error : theme.textSecondary)
      }
    }
    .fixedSize()
  }
}
