import ArgusKit
import ArgusUI
import GroveKit
import SwiftUI

typealias GitCommands = ArgusProtocol.Commands

/// Branch flows shared by the sidebar menus and the toolbar. Argus-specific
/// ones run through the host's git commands so its rules apply.
@MainActor
struct RefActions {
  let workspace: GitWorkspace
  let session: RemoteSession
  let model: DesktopModel
  let theme: Theme

  var marks: GitRefMarks { GitRefMarks.marks(for: session.repoRoot) }
  private var id: String { session.id }

  var currentBranch: BranchInfo? { workspace.refs.localBranches.first(where: \.isHEAD) }
  var currentName: String { currentBranch?.name ?? "HEAD" }
  var remoteNames: [String] { workspace.refs.remotes.map(\.name) }

  // MARK: Branches

  /// Checks out `branch`; a dirty tree that blocks it offers stash or discard.
  func checkout(_ branch: String) async {
    let label = "Checking out \(branch)…"
    if await workspace.host(GitCommands.GitCheckout.self, .init(id: id, branch: branch), label: label, track: .checkout)
      != nil
    {
      return
    }
    // The host's message for this is unreliable; a dirty tree is what blocks a checkout.
    guard workspace.workingCopy.changedCount > 0, workspace.hostError != nil else { return }
    let choice = await GitDialogs.choose(
      "Uncommitted changes",
      message: "Your changes would be overwritten by checking out \(branch). Stash them and switch, or discard them?",
      buttons: ["Stash & Switch", "Discard & Switch"])
    workspace.hostError = nil
    switch choice {
    case 0:
      await workspace.host(
        GitCommands.GitStashAndCheckout.self, .init(id: id, branch: branch), label: label, track: .checkout)
    case 1:
      guard
        await GitDialogs.confirm(
          "Discard all changes?", message: "Uncommitted changes are lost for good.", action: "Discard & Switch",
          destructive: true)
      else { return }
      await workspace.host(
        GitCommands.GitDiscardAndCheckout.self, .init(id: id, branch: branch), label: label, track: .checkout)
    default:
      break
    }
  }

  func newBranch(from start: String? = nil) {
    GitDialogs.sheet(theme: theme) { dismiss in
      BranchSheet(startPoint: start ?? currentName, dismiss: dismiss) { name, start, checkout in
        Task {
          await workspace.host(
            GitCommands.GitCreateBranch.self, .init(id: id, name: name, startPoint: start, checkout: checkout),
            label: "Creating \(name)…", track: .branchCreate)
        }
      }
    }
  }

  func rename(_ branch: String) {
    GitDialogs.sheet(theme: theme) { dismiss in
      GitNameSheet(
        title: "Rename \(branch)", label: "New name", primary: "Rename", initial: branch,
        validate: { GitNameSheet.isValidRef($0) && $0 != branch }, dismiss: dismiss
      ) { name, _ in
        Task {
          await workspace.host(
            GitCommands.GitRenameBranch.self, .init(id: id, from: branch, to: name), label: "Renaming \(branch)…",
            track: .branchRename)
        }
      }
    }
  }

  /// The session's own branch: the host renames it and updates the session.
  func renameSessionBranch() {
    let branch = session.branch
    GitDialogs.sheet(theme: theme) { dismiss in
      GitNameSheet(
        title: "Rename Branch", label: "New name", primary: "Rename", initial: branch,
        validate: { GitNameSheet.isValidRef($0) && $0 != branch }, dismiss: dismiss
      ) { name, _ in
        Task {
          await workspace.host(
            GitCommands.RenameSessionBranch.self, .init(id: id, branch: name), label: "Renaming \(branch)…",
            track: .branchRename)
        }
      }
    }
  }

  /// Deletes after a confirm; one with commits HEAD lacks warns and goes with `-D`.
  func delete(_ branch: String) async {
    let unmerged = ((try? await workspace.repository.aheadBehind(branch: branch, base: "HEAD"))?.ahead ?? 0) > 0
    guard
      await GitDialogs.confirm(
        unmerged ? "\(branch) isn't fully merged" : "Delete \(branch)?",
        message: unmerged
          ? "It has commits \(currentName) doesn't. Deleting it loses them."
          : "The branch is removed locally.",
        action: unmerged ? "Delete Anyway" : "Delete", destructive: true)
    else { return }
    await workspace.host(
      GitCommands.GitDeleteBranch.self, .init(id: id, name: branch, force: unmerged), label: "Deleting \(branch)…",
      track: .branchDelete)
  }

  func merge(_ branch: String, squash: Bool = false) async {
    await workspace.host(
      GitCommands.GitMergeBranch.self, .init(id: id, from: branch, into: currentBranch?.name, squash: squash),
      label: "Merging \(branch)…", track: .merge)
  }

  func rebaseCurrent(onto branch: String) async {
    await workspace.host(
      GitCommands.GitRebaseOnto.self, .init(id: id, upstream: branch), label: "Rebasing onto \(branch)…",
      track: .rebase)
  }

  func setUpstream(_ branch: BranchInfo) {
    let initial = branch.upstream ?? "\(remoteNames.first ?? "origin")/\(branch.name)"
    GitDialogs.sheet(theme: theme) { dismiss in
      GitNameSheet(
        title: "Set Upstream of \(branch.name)", label: "Upstream (remote/branch)", primary: "Set",
        initial: initial, dismiss: dismiss
      ) { upstream, _ in
        Task {
          await workspace.host(
            GitCommands.GitSetUpstream.self, .init(id: id, branch: branch.name, upstream: upstream),
            label: "Setting upstream…", track: .remote)
        }
      }
    }
  }

  func setPinned(_ branch: String, _ pinned: Bool) async {
    let list =
      pinned
      ? await workspace.host(
        GitCommands.GitPinBranch.self, .init(repoRoot: session.repoRoot, branch: branch), label: "Pinning…")
      : await workspace.host(
        GitCommands.GitUnpinBranch.self, .init(repoRoot: session.repoRoot, branch: branch), label: "Unpinning…")
    if let list { marks.pinned = list }
  }

  func setArchived(_ branch: String, _ archived: Bool) async {
    let list =
      archived
      ? await workspace.host(
        GitCommands.GitArchiveBranch.self, .init(repoRoot: session.repoRoot, branch: branch), label: "Archiving…")
      : await workspace.host(
        GitCommands.GitUnarchiveBranch.self, .init(repoRoot: session.repoRoot, branch: branch),
        label: "Unarchiving…")
    if let list { marks.archived = list }
  }

  func compareWithCurrent(_ ref: String) {
    model.navigate(.sessionGit(id: id, view: .compare(left: currentName, right: ref)))
  }

  /// Pull requests are their own view; open it for the branch's project.
  func createPullRequest() {
    model.navigate(.sessionGit(id: id, view: .pullRequests))
  }

  // MARK: Push and pull

  func push(_ branch: BranchInfo? = nil) {
    guard let branch = branch ?? currentBranch else { return }
    GitDialogs.sheet(theme: theme) { dismiss in
      PushSheet(
        remotes: remoteNames, branch: branch.name, hasUpstream: branch.upstream != nil, dismiss: dismiss,
        submit: { params in
          Task { await workspace.host(GitCommands.GitPushV2.self, params, label: "Pushing…", track: .push) }
        }, sessionId: id)
    }
  }

  func pull() async {
    let strategy = await workspace.repository.defaultPullStrategy()
    GitDialogs.sheet(theme: theme) { dismiss in
      PullSheet(remotes: remoteNames, branch: currentName, initialStrategy: strategy, dismiss: dismiss) {
        remote, branch, strategy in
        Task {
          await workspace.host(
            GitCommands.GitPullV2.self, .init(id: id, strategy: strategy, remote: remote, branch: branch),
            label: "Pulling…", track: .pull)
        }
      }
    }
  }

  func fetch() async {
    await workspace.host(GitCommands.GitFetch.self, .init(id: id), label: "Fetching…", track: .fetch)
  }

  // MARK: Stash and tags

  func stash() {
    GitDialogs.sheet(theme: theme) { dismiss in
      StashSheet(dismiss: dismiss) { message, untracked, keepIndex in
        Task {
          await workspace.host(
            GitCommands.GitStashSave.self,
            .init(id: id, includeUntracked: untracked, keepIndex: keepIndex, message: message),
            label: "Stashing…", track: .stashCreate)
        }
      }
    }
  }

  func newTag(at target: String? = nil) {
    GitDialogs.sheet(theme: theme) { dismiss in
      TagSheet(target: target ?? "HEAD", dismiss: dismiss) { name, target, message in
        Task {
          await workspace.host(
            GitCommands.GitCreateTag.self, .init(id: id, name: name, ref: target, message: message),
            label: "Tagging…", track: .tagCreate)
        }
      }
    }
  }

  func pushTag(_ tag: String) async {
    await workspace.host(
      GitCommands.GitPushTag.self, .init(id: id, name: tag, remote: remoteNames.first), label: "Pushing \(tag)…",
      track: .push)
  }

  func deleteTag(_ tag: String) async {
    guard
      await GitDialogs.confirm(
        "Delete tag \(tag)?", message: "The tag is removed locally; remotes keep their copy.", action: "Delete",
        destructive: true)
    else { return }
    await workspace.host(
      GitCommands.GitDeleteTag.self, .init(id: id, name: tag), label: "Deleting \(tag)…", track: .tagDelete)
  }
}
