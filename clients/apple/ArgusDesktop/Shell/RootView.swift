import ArgusCore
import ArgusUI
import SwiftUI

/// The window before the host is up says why; once it is, the three panels.
struct RootView: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    switch model.supervisor.state {
    case .running, .attached:
      MainWindow()
    case .locked(let holder):
      HostLockedView(holder: holder)
    case .holderExited(let holder):
      HostExitedView(holder: holder)
    case .waitingForHost:
      HostWaitingView()
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
    EmptyState(
      icon: "lock", title: "\(holder.holderName) is already running",
      body:
        "It is using \(model.supervisor.configuration.home.path). Only one app can run the Argus host on it at a time"
        + (model.supervisor.configuration.attachOnly
          ? ", and this window only attaches to one that lets it." : ".")
    ) {
      if !model.supervisor.configuration.attachOnly {
        Button("Quit \(holder.holderName) and Continue") { model.supervisor.takeOver() }
          .buttonStyle(.borderedProminent)
      }
      Button("Quit Argus") { AppDelegate.current?.quit() }
    }
  }
}

/// The app this window was attached to quit. One that comes back is joined on
/// its own; until then this app can run its own host instead.
struct HostExitedView: View {
  @Environment(DesktopModel.self) private var model
  let holder: HostLockRecord

  var body: some View {
    EmptyState(
      icon: "link.badge.plus", title: "\(holder.appName) quit",
      body:
        "This window was attached to its Argus host. It reconnects when \(holder.appName) opens again."
    ) {
      if !model.supervisor.configuration.attachOnly {
        Button("Start Argus Here") { model.supervisor.start() }
          .buttonStyle(.borderedProminent)
      }
      Button("Quit Argus") { AppDelegate.current?.quit() }
    }
  }
}

/// Attach-only (`ARGUS_ATTACH_HOME`) and nothing runs on that home yet.
struct HostWaitingView: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    EmptyState(
      icon: "hourglass", title: "Waiting for Argus",
      body:
        "This window only attaches to an Argus already running on \(model.supervisor.configuration.home.path). Open Argus and it connects."
    ) {
      Button("Quit Argus") { AppDelegate.current?.quit() }
    }
  }
}

struct HostFailedView: View {
  @Environment(DesktopModel.self) private var model
  let message: String

  var body: some View {
    EmptyState(icon: "exclamationmark.triangle", title: "The Argus host stopped", body: message) {
      Button("Try Again") { model.supervisor.retry() }
        .buttonStyle(.borderedProminent)
      Button("Show Log") {
        NSWorkspace.shared.activateFileViewerSelecting([model.supervisor.configuration.logFile])
      }
    }
  }
}
