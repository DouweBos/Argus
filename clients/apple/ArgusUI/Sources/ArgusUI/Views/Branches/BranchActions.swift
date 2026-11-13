import ArgusCore
import SwiftUI

/// What the Mac's branch menu does, for any branch on a project root. The row
/// context menus, swipe actions and the branch screen's menus all ask this;
/// `.branchActionPrompts(_:)` shows the confirmations and name sheets.
@MainActor @Observable
public final class BranchActions {
  public enum Confirm {
    case merge(squash: Bool), rebase, forcePush, delete(unmerged: Bool), dirty
  }

  struct Prompt: Identifiable {
    let confirm: Confirm
    let branch: RemoteGitBranch
    var id: String { "\(branch.id)-\(confirm)" }
  }

  enum NameSheet: Identifiable {
    /// A new branch; `from` preselects its start point.
    case create(from: String?)
    case rename(RemoteGitBranch)

    var id: String {
      switch self {
      case .create(let from): "create-\(from ?? "")"
      case .rename(let branch): "rename-\(branch.id)"
      }
    }
  }

  public let sessionId: String
  public let repoRoot: String
  /// The checked-out branch, once known.
  public var current: String?
  /// Every branch, for the new-branch sheet's start points.
  public var branches: [RemoteGitBranch] = []
  public private(set) var busy = false
  var prompt: Prompt?
  var nameSheet: NameSheet?

  public var onChanged: () async -> Void = {}
  public var onRenamed: (RemoteGitBranch, String) async -> Void = { _, _ in }
  public var onDeleted: (RemoteGitBranch) -> Void = { _ in }

  public init(sessionId: String, repoRoot: String) {
    self.sessionId = sessionId
    self.repoRoot = repoRoot
  }

  public var target: String { current ?? "the current branch" }

  public func ask(_ confirm: Confirm, about branch: RemoteGitBranch) {
    prompt = Prompt(confirm: confirm, branch: branch)
  }

  public func newBranch(from ref: String? = nil) { nameSheet = .create(from: ref) }
  public func rename(_ branch: RemoteGitBranch) { nameSheet = .rename(branch) }

  func run(_ action: @escaping () async -> Bool) {
    busy = true
    Task {
      if await action() { await onChanged() }
      busy = false
    }
  }

  public func checkout(_ branch: RemoteGitBranch, host: HostStore, dirty: String? = nil) {
    busy = true
    Task {
      let outcome = await host.checkoutBranch(
        sessionId: sessionId, repoRoot: repoRoot, branch: branch.name, dirty: dirty)
      busy = false
      switch outcome {
      case .dirty: ask(.dirty, about: branch)
      case .ok: await onChanged()
      case .failed: break
      }
    }
  }

  public func push(_ branch: RemoteGitBranch, host: HostStore, forceWithLease: Bool = false) {
    run {
      await host.pushBranch(
        sessionId: self.sessionId, branch: branch.name, remote: nil,
        setUpstream: branch.upstream == nil, forceWithLease: forceWithLease)
    }
  }

  public func pull(_ strategy: HostStore.PullStrategy, host: HostStore) {
    run { await host.pullCurrent(sessionId: self.sessionId, strategy: strategy) }
  }

  public func setPinned(_ branch: RemoteGitBranch, host: HostStore) {
    run {
      await host.setBranchPinned(
        sessionId: self.sessionId, branch: branch.name, pinned: branch.pinned != true)
    }
  }

  func delete(_ branch: RemoteGitBranch, host: HostStore, force: Bool) {
    busy = true
    Task {
      let outcome = await host.deleteBranch(sessionId: sessionId, name: branch.name, force: force)
      busy = false
      switch outcome {
      case .unmerged: ask(.delete(unmerged: true), about: branch)
      case .ok:
        onDeleted(branch)
        await onChanged()
      case .failed: break
      }
    }
  }

  public func openPullRequest(_ branch: RemoteGitBranch, host: HostStore, open: @escaping (URL) -> Void) {
    Task {
      if let url = await host.branchPullRequestURL(sessionId: sessionId, branch: branch.name) {
        open(url)
      } else {
        host.showError("This repo has no GitHub or GitLab remote.")
      }
    }
  }

  func create(name: String, from start: String?, checkout: Bool, host: HostStore) async {
    await host.createBranch(
      sessionId: sessionId, repoRoot: repoRoot, name: name, checkout: checkout, startPoint: start)
    await onChanged()
  }

  func rename(_ branch: RemoteGitBranch, to name: String, host: HostStore) async {
    if await host.renameLocalBranch(sessionId: sessionId, from: branch.name, to: name) {
      await onRenamed(branch, name)
      await onChanged()
    }
  }
}

extension View {
  /// The confirmations and name sheets `actions` asks for.
  public func branchActionPrompts(_ actions: BranchActions) -> some View {
    modifier(BranchActionPrompts(actions: actions))
  }
}

private struct BranchActionPrompts: ViewModifier {
  @Environment(HostStore.self) private var host
  @Bindable var actions: BranchActions

  func body(content: Content) -> some View {
    content
      .alert(item: $actions.prompt) { alert(for: $0) }
      .sheet(item: $actions.nameSheet) { sheet in
        switch sheet {
        case .create(let from):
          NewBranchSheet(
            branches: actions.branches, startPoint: from ?? actions.current
          ) { name, start, checkout in
            await actions.create(name: name, from: start, checkout: checkout, host: host)
          }
        case .rename(let branch):
          BranchNameSheet(title: "Rename \(branch.name)", initial: branch.name) { name in
            await actions.rename(branch, to: name, host: host)
          }
        }
      }
  }

  private func alert(for prompt: BranchActions.Prompt) -> Alert {
    let branch = prompt.branch
    let target = actions.target
    switch prompt.confirm {
    case .merge(let squash):
      return Alert(
        title: Text(squash ? "Squash \(branch.name) into \(target)?" : "Merge \(branch.name) into \(target)?"),
        message: Text("If it stops on conflicts, resolve them on the computer."),
        primaryButton: .default(Text(squash ? "Squash" : "Merge")) {
          actions.run {
            await host.mergeIntoCurrent(sessionId: actions.sessionId, from: branch.ref, squash: squash)
          }
        },
        secondaryButton: .cancel())
    case .rebase:
      return Alert(
        title: Text("Rebase \(target) onto \(branch.name)?"),
        message: Text("This rewrites \(target)'s commits. If it stops on conflicts, resolve them on the computer."),
        primaryButton: .destructive(Text("Rebase")) {
          actions.run { await host.rebaseCurrent(sessionId: actions.sessionId, onto: branch.ref) }
        },
        secondaryButton: .cancel())
    case .forcePush:
      return Alert(
        title: Text("Force push \(branch.name)?"),
        message: Text("Overwrites the remote branch, unless someone pushed since you last fetched."),
        primaryButton: .destructive(Text("Force push")) {
          actions.push(branch, host: host, forceWithLease: true)
        },
        secondaryButton: .cancel())
    case .delete(let unmerged):
      return Alert(
        title: Text(unmerged ? "\(branch.name) isn't fully merged" : "Delete \(branch.name)?"),
        message: Text(
          unmerged
            ? "It has commits that aren't on any other branch. Deleting it loses them."
            : "This deletes the local branch."),
        primaryButton: .destructive(Text(unmerged ? "Delete anyway" : "Delete")) {
          actions.delete(branch, host: host, force: unmerged)
        },
        secondaryButton: .cancel())
    case .dirty:
      return Alert(
        title: Text("Uncommitted changes"),
        message: Text("Switching to \(branch.name) would overwrite local changes."),
        primaryButton: .default(Text("Stash & switch")) {
          actions.checkout(branch, host: host, dirty: "stash")
        },
        secondaryButton: .cancel())
    }
  }
}
