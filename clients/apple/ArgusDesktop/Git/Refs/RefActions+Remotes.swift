import ArgusKit
import ArgusUI
import GroveKit
import SwiftUI

extension RefActions {
  /// One remote; the host's fetch takes them all, so this runs through GroveKit.
  func fetch(remote: String) async {
    await run(.fetch(remote: remote))
  }

  /// Grove's Sync: fetch, then pull what's behind and push what's ahead, through
  /// the host so its branch rules apply. An unpublished branch opens Publish instead.
  func sync() async {
    guard let branch = currentBranch else { return }
    guard branch.upstream != nil else { return push(branch) }
    await run(.sync(remote: nil, strategy: await workspace.repository.defaultPullStrategy()))
  }

  func addRemote() {
    present(.addRemote)
  }

  /// Renames it or points it elsewhere.
  func editRemote(_ remote: RemoteInfo) {
    present(.editRemote(remote))
  }

  func removeRemote(_ remote: String) async {
    guard
      await GitDialogs.confirm(
        "Remove \(remote)?", message: "Its remote-tracking branches go with it.", action: "Remove",
        destructive: true)
    else { return }
    await run(.removeRemote(remote))
  }

  func pruneRemote(_ remote: String) async {
    await run(.pruneRemote(remote))
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
    await run(.deleteRemoteBranch(name: name, remote: remote))
  }

  static func localName(of branch: BranchInfo) -> String {
    guard let remote = branch.remoteName, branch.name.hasPrefix(remote + "/") else { return branch.name }
    return String(branch.name.dropFirst(remote.count + 1))
  }
}
