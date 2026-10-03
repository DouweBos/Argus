import ArgusKit
import ArgusUI
import GroveKit
import SwiftUI

extension RefActions {
  /// One remote; the host's fetch takes them all, so this runs through GroveKit.
  func fetch(remote: String) async {
    await workspace.run(.fetch, label: "Fetching \(remote)…") {
      try await workspace.repository.fetch(remote: remote, progress: nil)
    }
  }

  func addRemote() {
    GitDialogs.sheet(theme: theme) { dismiss in
      RemoteSheet(dismiss: dismiss) { name, url in
        Task {
          await workspace.host(
            GitCommands.GitAddRemote.self, .init(id: session.id, name: name, url: url), label: "Adding \(name)…",
            track: .remote)
        }
      }
    }
  }

  func renameRemote(_ remote: String) {
    GitDialogs.sheet(theme: theme) { dismiss in
      GitNameSheet(
        title: "Rename \(remote)", label: "New name", primary: "Rename", initial: remote,
        validate: { GitNameSheet.isValidRef($0) && $0 != remote }, dismiss: dismiss
      ) { name, _ in
        Task {
          await workspace.host(
            GitCommands.GitRenameRemote.self, .init(id: session.id, from: remote, to: name),
            label: "Renaming \(remote)…", track: .remote)
        }
      }
    }
  }

  func setRemoteURL(_ remote: RemoteInfo) {
    GitDialogs.sheet(theme: theme) { dismiss in
      GitNameSheet(
        title: "URL of \(remote.name)", label: "URL", primary: "Set", initial: remote.url, dismiss: dismiss
      ) { url, _ in
        Task {
          await workspace.host(
            GitCommands.GitSetRemoteUrl.self, .init(id: session.id, name: remote.name, url: url),
            label: "Setting URL…", track: .remote)
        }
      }
    }
  }

  func removeRemote(_ remote: String) async {
    guard
      await GitDialogs.confirm(
        "Remove \(remote)?", message: "Its remote-tracking branches go with it.", action: "Remove",
        destructive: true)
    else { return }
    await workspace.host(
      GitCommands.GitRemoveRemote.self, .init(id: session.id, name: remote), label: "Removing \(remote)…",
      track: .remote)
  }

  func pruneRemote(_ remote: String) async {
    await workspace.host(
      GitCommands.GitPruneRemote.self, .init(id: session.id, name: remote), label: "Pruning \(remote)…",
      track: .remote)
  }

  /// `remote/feature/x` checks out as a local `feature/x` tracking it.
  func checkoutRemote(_ branch: BranchInfo) async {
    await checkout(Self.localName(of: branch))
  }

  func deleteRemoteBranch(_ branch: BranchInfo) async {
    guard let remote = branch.remoteName else { return }
    let name = Self.localName(of: branch)
    guard
      await GitDialogs.confirm(
        "Delete \(name) on \(remote)?", message: "The branch is removed from the remote for everyone.",
        action: "Delete", destructive: true)
    else { return }
    await workspace.run(.branchDelete, label: "Deleting \(branch.name)…") {
      try await workspace.repository.deleteRemoteBranch(name: name, remote: remote)
    }
  }

  static func localName(of branch: BranchInfo) -> String {
    guard let remote = branch.remoteName, branch.name.hasPrefix(remote + "/") else { return branch.name }
    return String(branch.name.dropFirst(remote.count + 1))
  }
}
