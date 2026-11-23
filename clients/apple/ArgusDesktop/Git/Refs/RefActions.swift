import ArgusKit
import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

typealias GitCommands = ArgusProtocol.Commands

/// Branch flows shared by the sidebar menus, the toolbar and the Git menu. Every change runs
/// through the host's git commands so its rules apply; a failure shows in the panel's banner.
@MainActor
struct RefActions {
  let workspace: GitWorkspace
  let session: RemoteSession
  let model: DesktopModel
  /// Read once: every row's context menu names it, and a scan per row is slow with thousands of refs.
  let currentBranch: BranchInfo?

  init(workspace: GitWorkspace, session: RemoteSession, model: DesktopModel) {
    self.workspace = workspace
    self.session = session
    self.model = model
    currentBranch = workspace.refs.localBranches.first(where: \.isHEAD)
  }

  var marks: GitRefMarks { GitRefMarks.marks(for: session.repoRoot) }
  private var id: String { session.id }

  var currentName: String { currentBranch?.name ?? "HEAD" }
  var remoteNames: [String] { workspace.refs.remotes.map(\.name) }

  /// What the dialogs run against: the session's base leads their pickers, and Pin goes through the host.
  var dialogContext: GitDialogContext {
    var context = GitDialogContext(repository: workspace.repository, refs: workspace.refs, commands: workspace.commands)
    context.preferredBranch = session.baseBranch
    context.undo = workspace.undo
    context.pinBranch = { [self] name in await setPinned(name, true) }
    return context
  }

  func present(_ dialog: GitDialog) {
    model.gitDialogs.present(dialog, context: dialogContext)
  }

  /// Runs a command; a failure, or a missing feature, is in the banner.
  @discardableResult
  func run(_ command: GitCommand) async -> Bool {
    do {
      try await workspace.commands.perform(command)
      return true
    } catch let error as GitFeatureError {
      workspace.showFailure(GitFailure(kind: .unknown, message: error.reason))
      return false
    } catch {
      return false
    }
  }

  // MARK: Branches

  /// Checks out `branch`; a dirty tree that blocks it offers stash or discard.
  func checkout(_ branch: String) async {
    if await run(.checkout(branch)) { return }
    // The host's message for this is unreliable; a dirty tree is what blocks a checkout.
    guard workspace.workingCopy.changedCount > 0, workspace.hostError != nil else { return }
    let choice = await GitDialogs.choose(
      "Uncommitted changes",
      message: "Your changes would be overwritten by checking out \(branch). Stash them and switch, or discard them?",
      buttons: ["Stash and Switch", "Discard and Switch"])
    workspace.hostError = nil
    switch choice {
    case 0:
      await run(.stashAndCheckout(branch))
    case 1:
      guard
        await GitDialogs.confirm(
          "Discard all changes?", message: "Uncommitted changes are lost for good.", action: "Discard and Switch",
          destructive: true)
      else { return }
      await run(.discardAndCheckout(branch))
    default:
      break
    }
  }

  func newBranch(from start: String? = nil) {
    present(.createBranch(from: start))
  }

  func rename(_ branch: String) {
    present(.renameBranch(branch))
  }

  /// The session's own branch: the host renames it and updates the session.
  func renameSessionBranch() {
    present(.renameCurrentBranch)
  }

  /// Warns about commits HEAD lacks and offers the remote branch and a forced delete.
  func delete(_ branch: BranchInfo) {
    present(.deleteBranch(branch))
  }

  func merge(_ branch: String, squash: Bool = false) async {
    await run(.merge(branch, squash: squash))
  }

  func rebaseCurrent(onto branch: String) async {
    await run(.rebase(onto: branch))
  }

  /// The Git menu's Merge and Rebase: pick the other branch first.
  func chooseMerge() {
    present(.merge)
  }

  func chooseRebase() {
    present(.rebase)
  }

  func setUpstream(_ branch: BranchInfo) {
    present(.trackRemoteBranch(branch))
  }

  func setPinned(_ branch: String, _ pinned: Bool) async {
    let list =
      pinned
      ? await workspace.host(
        GitCommands.GitPinBranch.self, .init(repoRoot: session.repoRoot, branch: branch), label: "Pinning", track: .pin)
      : await workspace.host(
        GitCommands.GitUnpinBranch.self, .init(repoRoot: session.repoRoot, branch: branch), label: "Unpinning", track: .pin)
    if let list { marks.pinned = list }
  }

  func setArchived(_ branch: String, _ archived: Bool) async {
    let list =
      archived
      ? await workspace.host(
        GitCommands.GitArchiveBranch.self, .init(repoRoot: session.repoRoot, branch: branch), label: "Archiving", track: .archive)
      : await workspace.host(
        GitCommands.GitUnarchiveBranch.self, .init(repoRoot: session.repoRoot, branch: branch),
        label: "Unarchiving", track: .archive)
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

  /// Pushes `branch`, the checked-out one by default; one without an upstream is published.
  func push(_ branch: BranchInfo? = nil) {
    guard let branch = branch ?? currentBranch else { return }
    present(.push(branch: branch.name))
  }

  func pull() {
    present(.pull)
  }

  func fetch() async {
    await run(.fetch(remote: nil))
  }

  // MARK: Stash and tags

  func stash() {
    present(.stash())
  }

  /// Grove's Snapshot: a stash of the changes that leaves them in place.
  func snapshot() {
    present(.snapshot)
  }

  func newTag(at target: String? = nil) {
    present(.createTag(at: target))
  }

  func pushTag(_ tag: String) async {
    await run(.pushTag(tag, remote: remoteNames.first))
  }

  func deleteTag(_ tag: String) async {
    guard
      await GitDialogs.confirm(
        "Delete tag \(tag)?", message: "The tag is removed locally; remotes keep their copy.", action: "Delete",
        destructive: true)
    else { return }
    await run(.deleteTag(tag))
  }
}
