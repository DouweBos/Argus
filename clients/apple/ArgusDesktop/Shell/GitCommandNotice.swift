import ArgusUI
import SwiftUI

/// What the last git command from a menu or key has to say.
struct GitNotice: Equatable {
  let sessionId: String
  var running: GitMenuAction?
  var message: String?
}

/// A git command's progress, refusal or failure, floated over whichever panel it ran from.
struct GitCommandNotice: View {
  @Environment(\.theme) private var theme
  @Environment(DesktopModel.self) private var model

  var body: some View {
    if let notice = model.gitNotice, notice.sessionId == model.route.sessionId {
      content(notice)
        .frame(maxWidth: 520)
        .padding(12)
    }
  }

  @ViewBuilder
  private func content(_ notice: GitNotice) -> some View {
    let workspace = model.git.workspace(notice.sessionId)
    if let message = notice.message {
      Banner(text: message, onDismiss: { model.gitNotice = nil })
        .background(theme.bgTertiary, in: .rect(cornerRadius: theme.radiusSmall))
        .task(id: notice) {
          try? await Task.sleep(for: .seconds(4))
          if model.gitNotice == notice { model.gitNotice = nil }
        }
    } else if let label = workspace?.hostBusy ?? notice.running.map({ _ in "Reading the repository" }) {
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text(label)
      }
      .padding(10)
      .background(theme.bgTertiary, in: .rect(cornerRadius: theme.radiusSmall))
    } else if model.sessionPanel != .git, let workspace, let failure = workspace.failure {
      // The git panel shows its own banner.
      GitFailureBanner(
        workspace: workspace, session: model.session(notice.sessionId), failure: failure,
        canRetry: workspace.canRetry
      ) { workspace.hostError = nil }
      .background(theme.bgTertiary, in: .rect(cornerRadius: theme.radiusSmall))
    }
  }
}
