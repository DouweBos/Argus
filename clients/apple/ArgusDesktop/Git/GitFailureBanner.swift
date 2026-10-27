import AppKit
import ArgusCore
import ArgusUI
import GroveKit
import SwiftUI

/// A failed git command with the fixes git's output points at — pull then
/// push, a lease-protected force push, publishing, resolving conflicts — as
/// the desktop's error banner offers them.
struct GitFailureBanner: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  /// Publishing needs the session's branch; nil leaves that fix out.
  let session: RemoteSession?
  let failure: GitFailure
  let canRetry: Bool
  let dismiss: () -> Void

  var body: some View {
    let offered = failure.actions(canRetry: canRetry).filter { $0 != .publishBranch || session != nil }
    GitErrorBanner(message: failure.message, actions: offered, dismiss: dismiss) { action in
      Task { await perform(action) }
    }
  }


  private func perform(_ action: GitFailure.Action) async {
    MacTelemetry.capture(.gitRecoveryUsed(kind: failure.kind.rawValue, action: action.rawValue))
    let id = workspace.sessionId
    switch action {
    case .publishBranch:
      guard let session else { return }
      dismiss()
      RefActions(workspace: workspace, session: session, model: model, theme: theme).push()
    case .pullThenPush:
      guard let push = workspace.lastPush else { return }
      let strategy = await workspace.repository.defaultPullStrategy()
      guard
        await workspace.host(
          GitCommands.GitPullV2.self, .init(id: id, strategy: strategy.wire, remote: push.remote, branch: push.branch),
          label: "Pulling…", track: .pull) != nil
      else { return }
      await workspace.host(GitCommands.GitPushV2.self, push, label: "Pushing…", track: .push)
    case .forceWithLease:
      guard var push = workspace.lastPush,
        await GitDialogs.confirm(
          "Force push \(push.branch ?? "the branch")?",
          message: "This replaces the remote branch with yours, unless someone pushed since your last fetch.",
          action: "Force Push", destructive: true)
      else { return }
      push.forceWithLease = true
      push.force = nil
      workspace.lastPush = push
      await workspace.host(GitCommands.GitPushV2.self, push, label: "Force pushing…", track: .push)
    case .retry:
      await workspace.retry?()
    case .stashAndRetry:
      guard
        await workspace.host(
          GitCommands.GitStashSave.self, .init(id: id, includeUntracked: true, keepIndex: false, message: nil),
          label: "Stashing…", track: .stashCreate) != nil
      else { return }
      await workspace.retry?()
    case .openConflicts:
      dismiss()
      model.navigate(.sessionGit(id: id, view: .conflicts))
    case .continueOperation:
      dismiss()
      await WorkingCopyActions(workspace: workspace).continueOperation()
    case .abortOperation:
      dismiss()
      await WorkingCopyActions(workspace: workspace).abortOperation()
    case .installLFS:
      ExternalLinks.open("https://git-lfs.com")
    case .configureSigning:
      dismiss()
      model.navigate(.sessionGit(id: id, view: .settings))
    case .copyDetails:
      Clipboard.copy(failure.details ?? failure.message)
    }
  }
}

/// A failed git command: what git said, its fixes, dismissable.
struct GitErrorBanner: View {
  @Environment(\.theme) private var theme
  let message: String
  var actions: [GitFailure.Action] = []
  let dismiss: () -> Void
  var perform: (GitFailure.Action) -> Void = { _ in }

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(theme.error)
      Text(message)
        .font(.scaled(size: 12))
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
      ForEach(actions, id: \.self) { action in
        Button(action.label, role: action.isDestructive ? .destructive : nil) { perform(action) }
          .controlSize(.small)
      }
      if !actions.contains(.copyDetails) {
        Button("Copy") { Clipboard.copy(message) }
          .buttonStyle(.argusBorderless)
          .controlSize(.small)
      }
      Button(action: dismiss) { Image(systemName: "xmark") }
        .buttonStyle(.argusBorderless)
        .help("Dismiss")
    }
    .padding(10)
    .background(theme.errorSoft)
  }
}

/// Links the git panel opens on this Mac, e.g. an installer's page.
@MainActor
enum ExternalLinks {
  static func open(_ link: String) {
    guard let url = URL(string: link) else { return }
    #if DEBUG
      if ProcessInfo.processInfo.environment["ARGUS_DEV_DRY_OPEN"] != nil {
        NSLog("[argus] dry-open url %@", link)
        return
      }
    #endif
    NSWorkspace.shared.open(url)
  }
}

extension GroveKit.PullStrategy {
  /// The host's name for the strategy.
  var wire: ArgusProtocol.CommandsTypes.GitPullV2ParamsStrategy {
    switch self {
    case .merge: .init(rawValue: "merge")
    case .rebase: .init(rawValue: "rebase")
    case .fastForwardOnly: .init(rawValue: "ff-only")
    }
  }
}

/// The typed `failure` of a remote session's last failed git run, so its
/// banner can offer the same fixes; GroveKit itself only keeps the message.
nonisolated final class RemoteGitFailures: @unchecked Sendable {
  static let shared = RemoteGitFailures()
  private let lock = NSLock()
  private var latest: [String: (failure: GitFailure, at: Date)] = [:]

  func record(_ failure: GitFailure, sessionId: String) {
    lock.withLock { latest[sessionId] = (failure, Date()) }
  }

  /// The session's failure if it happened in the last `window` seconds.
  func recent(sessionId: String, window: TimeInterval = 30) -> GitFailure? {
    lock.withLock {
      guard let entry = latest[sessionId], Date().timeIntervalSince(entry.at) < window else { return nil }
      return entry.failure
    }
  }
}
