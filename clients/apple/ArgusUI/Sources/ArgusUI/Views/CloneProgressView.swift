import ArgusCore
import ArgusKit
import SwiftUI

/// A clone as it runs, fails or is cancelled: the repository, where it lands,
/// the phase with its percent and one bar across every phase. Shared by the
/// Mac sheet and the phone screen.
public struct CloneProgressView: View {
  @Environment(\.theme) private var theme
  let job: ArgusProtocol.CloneJob

  public init(job: ArgusProtocol.CloneJob) {
    self.job = job
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(job.url).font(.scaled(.headline)).lineLimit(1).truncationMode(.middle)
        Text(job.path).font(.scaled(.caption).monospaced()).foregroundStyle(theme.textSecondary)
          .lineLimit(1).truncationMode(.middle)
      }
      switch job.status {
      case .running:
        if let fraction = CloneRepositoryModel.overallFraction(job), job.percent != nil {
          ProgressView(value: fraction)
        } else {
          ProgressView().progressViewStyle(.linear)
        }
        Text(CloneRepositoryModel.progressLabel(job))
          .font(.scaled(.caption)).foregroundStyle(theme.textSecondary).monospacedDigit()
      case .failed:
        Label(job.error ?? "The clone failed.", systemImage: Icon.warning)
          .font(.scaled(.callout)).foregroundStyle(theme.error).textSelection(.enabled)
      case .cancelled:
        Text("Cancelled. Nothing was left behind.").font(.scaled(.callout)).foregroundStyle(theme.textSecondary)
      default:
        Label("Cloned and added as a project", systemImage: Icon.check)
          .font(.scaled(.callout)).foregroundStyle(theme.success)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
