import AppKit
import ArgusKit
import ArgusUI
import GroveKit
import UniformTypeIdentifiers

/// What the History screen does to commits: the host's typed commands where
/// Argus has its own flow (checkout, branch, tag), GroveKit for the rest.
/// Every action reports its telemetry once, from here.
@MainActor
struct HistoryActions {
  let workspace: GitWorkspace
  let history: HistoryViewModel
  let navigate: (GitRoute) -> Void
  /// Asks before a detached checkout; the screen owns the dialog.
  var confirmCheckout: (CommitInfo) -> Void = { _ in }

  // MARK: Host-run

  func checkout(_ commit: CommitInfo) async {
    await workspace.host(
      ArgusProtocol.Commands.GitCheckout.self, .init(id: workspace.sessionId, branch: commit.id),
      label: "Checking out \(commit.shortSHA)", track: .checkout)
  }

  @discardableResult
  func createBranch(_ name: String, at commit: CommitInfo, checkout: Bool) async -> Bool {
    let done = await workspace.host(
      ArgusProtocol.Commands.GitCreateBranch.self,
      .init(id: workspace.sessionId, name: name, startPoint: commit.id, checkout: checkout),
      label: "Creating \(name)", track: .branchCreate)
    return done != nil
  }

  @discardableResult
  func createTag(_ name: String, at commit: CommitInfo, message: String?) async -> Bool {
    let done = await workspace.host(
      ArgusProtocol.Commands.GitCreateTag.self,
      .init(id: workspace.sessionId, name: name, ref: commit.id, message: message),
      label: "Tagging \(name)", track: .tagCreate)
    return done != nil
  }

  // MARK: GroveKit

  /// Runs a view-model mutation, which reports failure in `errorMessage`.
  func perform(_ action: MacTelemetryEvent.GitAction, _ work: () async -> Void) async {
    history.dismissError()
    await work()
    let failed = history.errorMessage != nil
    workspace.track(action, success: !failed)
    if workspace.repository.repositoryState != .normal { navigate(.conflicts) }
  }

  func cherryPick(_ commit: CommitInfo) async {
    await perform(.cherryPick) { await history.cherryPick(commit) }
  }

  // MARK: Export

  func savePatch(_ commits: [CommitInfo]) async {
    guard let url = await savePanel(name: history.patchFileName(for: commits), type: nil) else { return }
    await history.savePatch(commits, to: url)
  }

  func exportArchive(_ commit: CommitInfo) async {
    guard let url = await savePanel(name: history.archiveFileName(for: commit), type: .zip) else { return }
    await history.exportArchive(of: commit, to: url)
  }

  // MARK: Menu

  /// The commit context menu; `selected` is the multi-selection when the click was inside it.
  func fill(_ menu: NSMenu, commit: CommitInfo, selected: [CommitInfo]) {
    menu.autoenablesItems = false
    let short = "\u{201C}\(commit.shortSHA)\u{201D}"
    menu.addItem(ActionMenuItem("Copy SHA") { Clipboard.copy(commit.id) })
    menu.addItem(ActionMenuItem("Copy Short SHA") { Clipboard.copy(commit.shortSHA) })
    menu.addItem(ActionMenuItem("Copy Message") { Clipboard.copy(commit.message) })
    menu.addItem(.separator())
    menu.addItem(
      ActionMenuItem("Check Out \(short)…", enabled: workspace.isProjectRoot && commit.id != history.headSHA) {
        confirmCheckout(commit)
      })
    menu.addItem(ActionMenuItem("Create Branch Here…") { history.request(.createBranch(commit)) })
    menu.addItem(ActionMenuItem("Create Tag Here…") { history.request(.createTag(commit)) })
    menu.addItem(.separator())
    menu.addItem(
      ActionMenuItem("Cherry-Pick \(short)", enabled: commit.id != history.headSHA) {
        Task { await cherryPick(commit) }
      })
    menu.addItem(ActionMenuItem("Revert \(short)…") { history.request(.revert(commit)) })
    menu.addItem(
      ActionMenuItem("Reset \(history.headBranchName ?? "HEAD") to Here…", enabled: history.filterBranch == nil) {
        history.request(.reset(commit))
      })
    menu.addItem(.separator())
    menu.addItem(
      ActionMenuItem("Edit Message…", enabled: history.canRewrite(commit)) { history.request(.reword(commit)) })
    if selected.count > 1 {
      menu.addItem(
        ActionMenuItem("Squash \(selected.count) Commits…", enabled: history.canSquash(selected)) {
          history.request(.squashCommits(selected))
        })
    } else {
      menu.addItem(
        ActionMenuItem("Squash with Parent…", enabled: history.canSquashWithParent(commit)) {
          history.request(.squash(commit))
        })
    }
    menu.addItem(
      ActionMenuItem("Interactive Rebase from Here…", enabled: history.canRebaseInteractively(onto: commit)) {
        navigate(.interactiveRebase(from: commit.id))
      })
    menu.addItem(ActionMenuItem("Drop \(short)…", enabled: history.canRewrite(commit)) { history.request(.drop(commit)) })
    menu.addItem(.separator())
    menu.addItem(
      ActionMenuItem("Compare with HEAD") {
        navigate(.compare(left: history.headBranchName ?? "HEAD", right: commit.id))
      })
    menu.addItem(.separator())
    let patchTitle = selected.count > 1 ? "Save \(selected.count) Commits as Patch…" : "Save as Patch…"
    menu.addItem(
      ActionMenuItem(patchTitle, enabled: history.canSavePatch(selected)) { Task { await savePatch(selected) } })
    menu.addItem(ActionMenuItem("Export Archive…") { Task { await exportArchive(commit) } })
  }

  // MARK: Panels

  private func savePanel(name: String, type: UTType?) async -> URL? {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.canCreateDirectories = true
    if let type { panel.allowedContentTypes = [type] }
    let response = await panel.begin()
    return response == .OK ? panel.url : nil
  }
}

/// A menu item that runs a closure.
final class ActionMenuItem: NSMenuItem {
  private let handler: () -> Void

  init(_ title: String, enabled: Bool = true, handler: @escaping () -> Void) {
    self.handler = handler
    super.init(title: title, action: #selector(fire), keyEquivalent: "")
    target = self
    isEnabled = enabled
  }

  @available(*, unavailable)
  required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  @objc private func fire() { handler() }
}
