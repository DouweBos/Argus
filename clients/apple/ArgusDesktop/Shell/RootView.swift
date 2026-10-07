import ArgusCore
import SwiftUI

/// The window before the host is up says why; once it is, the three panels.
struct RootView: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    switch model.supervisor.state {
    case .running:
      MainWindow()
    case .locked(let holder):
      HostLockedView(holder: holder)
    case .handingOver(let holder):
      HostStatusView(title: "Waiting for \(holder.holderName) to quit…", busy: true)
    case .failed(let message):
      HostFailedView(message: message)
    case .restarting:
      HostStatusView(title: "Restarting the Argus host…", busy: true)
    case .idle, .starting:
      HostStatusView(title: "Starting Argus…", busy: true)
    case .stopped:
      HostStatusView(title: "Argus has stopped.", busy: false)
    }
  }
}

struct HostStatusView: View {
  let title: String
  let busy: Bool

  var body: some View {
    VStack(spacing: 12) {
      if busy { ProgressView() }
      Text(title).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// Another app's host is on this Argus home. Two would fight over the same
/// worktrees, so this one waits until the user picks.
struct HostLockedView: View {
  @Environment(DesktopModel.self) private var model
  let holder: HostLockRecord

  var body: some View {
    ContentUnavailableView {
      Label("\(holder.holderName) is already running", systemImage: "lock")
    } description: {
      Text(
        "It is using \(model.supervisor.configuration.home.path). Only one app can run the Argus host on it at a time."
      )
    } actions: {
      Button("Quit \(holder.holderName) and Continue") { model.supervisor.takeOver() }
        .buttonStyle(.borderedProminent)
      Button("Quit Argus") { AppDelegate.current?.quit() }
    }
  }
}

struct HostFailedView: View {
  @Environment(DesktopModel.self) private var model
  let message: String

  var body: some View {
    ContentUnavailableView {
      Label("The Argus host stopped", systemImage: "exclamationmark.triangle")
    } description: {
      Text(message)
    } actions: {
      Button("Try Again") { model.supervisor.retry() }
        .buttonStyle(.borderedProminent)
      Button("Show Log") {
        NSWorkspace.shared.activateFileViewerSelecting([model.supervisor.configuration.logFile])
      }
    }
  }
}
