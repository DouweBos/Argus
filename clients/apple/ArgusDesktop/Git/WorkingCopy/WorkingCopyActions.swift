import GroveKit

/// The working copy's mutations. Each clears the last error first; the view
/// model reports the action to telemetry itself (`GitWorkspace` wires `onAction`).
@MainActor
struct WorkingCopyActions {
  let workspace: GitWorkspace
  var vm: WorkingCopyViewModel { workspace.workingCopy }

  private func perform(_ work: () async -> Void) async {
    vm.clearError()
    await work()
  }

  func stage(_ entry: StatusEntry) async { await perform { await vm.stageFile(entry) } }
  func unstage(_ entry: StatusEntry) async { await perform { await vm.unstageFile(entry) } }
  func stageAll() async { await perform { await vm.stageAll() } }
  func unstageAll() async { await perform { await vm.unstageAll() } }

  /// Space and the context menu: stage what's unstaged, unstage what's staged.
  func toggle(_ rows: Set<FileRow>) async { await perform { await vm.toggleStage(rows) } }

  func toggleSelection() async {
    let conflicted = Set(vm.conflictedFiles.map(\.path))
    await toggle(vm.fileSelection.rows.filter { !conflicted.contains($0.path) })
  }

  func ignore(_ target: IgnoreTarget, of entries: [StatusEntry], localOnly: Bool) async {
    await perform { await vm.ignore(target, of: entries, localOnly: localOnly) }
  }
  func stopTracking(_ entries: [StatusEntry]) async { await perform { await vm.stopTracking(entries) } }
  func rename(_ entry: StatusEntry, to path: String) async { await perform { await vm.rename(entry, to: path) } }
  func moveToTrash(_ entries: [StatusEntry]) async { await perform { await vm.moveToTrash(entries) } }

  func discard(_ entries: [StatusEntry]) async { await perform { await vm.discard(entries) } }

  /// A discard that needs confirming parks in `pendingHunkDiscard` until confirmed.
  func hunk(_ action: HunkAction, _ hunk: HunkData, _ lines: [GroveKit.DiffLine]) async {
    await perform { await vm.performHunkAction(action, hunk: hunk, lines: lines) }
  }

  func confirmHunkDiscard(_ pending: PendingHunkDiscard, dontAskAgain: Bool) async {
    await perform { await vm.confirmHunkDiscard(pending, dontAskAgain: dontAskAgain) }
  }

  func commit() async { await perform { await vm.commit() } }
  func continueOperation() async { await perform { await vm.continueOperation() } }
  func abortOperation() async { await perform { await vm.abortOperation() } }
  func resolve(taking side: ConflictSide) async { await perform { await vm.resolveConflict(taking: side) } }
}
