import GroveKit

/// The working copy's mutations with their telemetry. GroveKit reports
/// failures through `errorMessage` rather than throwing, so success is "no
/// error after".
@MainActor
struct WorkingCopyActions {
  let workspace: GitWorkspace
  var vm: WorkingCopyViewModel { workspace.workingCopy }

  func tracked(_ action: MacTelemetryEvent.GitAction?, _ work: () async -> Void) async {
    vm.clearError()
    await work()
    if let action { workspace.track(action, success: vm.errorMessage == nil) }
  }

  func stage(_ entry: StatusEntry) async { await tracked(.stage) { await vm.stageFile(entry) } }
  func unstage(_ entry: StatusEntry) async { await tracked(.unstage) { await vm.unstageFile(entry) } }
  func stageAll() async { await tracked(.stage) { await vm.stageAll() } }
  func unstageAll() async { await tracked(.unstage) { await vm.unstageAll() } }

  /// Space and the context menu: stage what's unstaged, unstage what's staged.
  func toggle(_ rows: Set<FileRow>) async {
    let action: MacTelemetryEvent.GitAction = rows.contains { $0.side == .unstaged } ? .stage : .unstage
    await tracked(action) { await vm.toggleStage(rows) }
  }

  func toggleSelection() async {
    let conflicted = Set(vm.conflictedFiles.map(\.path))
    await toggle(vm.fileSelection.rows.filter { !conflicted.contains($0.path) })
  }

  func ignore(_ target: IgnoreTarget, of entries: [StatusEntry], localOnly: Bool) async {
    await tracked(.fileAction) { await vm.ignore(target, of: entries, localOnly: localOnly) }
  }
  func stopTracking(_ entries: [StatusEntry]) async { await tracked(.fileAction) { await vm.stopTracking(entries) } }
  func rename(_ entry: StatusEntry, to path: String) async { await tracked(.fileAction) { await vm.rename(entry, to: path) } }
  func moveToTrash(_ entries: [StatusEntry]) async { await tracked(.fileAction) { await vm.moveToTrash(entries) } }

  func discard(_ entries: [StatusEntry]) async { await tracked(.discard) { await vm.discard(entries) } }

  /// A discard that needs confirming parks in `pendingHunkDiscard` and is tracked when confirmed.
  func hunk(_ action: HunkAction, _ hunk: HunkData, _ lines: [GroveKit.DiffLine]) async {
    vm.clearError()
    await vm.performHunkAction(action, hunk: hunk, lines: lines)
    guard vm.pendingHunkDiscard == nil else { return }
    workspace.track(Self.telemetry(action), success: vm.errorMessage == nil)
  }

  func confirmHunkDiscard(_ pending: PendingHunkDiscard, action: HunkAction?, dontAskAgain: Bool) async {
    await tracked(action.map(Self.telemetry) ?? .discardHunk) {
      await vm.confirmHunkDiscard(pending, dontAskAgain: dontAskAgain)
    }
  }

  func commit() async {
    let amend = vm.isAmend
    await tracked(amend ? .amend : .commit) { await vm.commit() }
  }

  func continueOperation() async { await tracked(.continueOperation) { await vm.continueOperation() } }
  func abortOperation() async { await tracked(.abortOperation) { await vm.abortOperation() } }
  func resolve(taking side: ConflictSide) async {
    await tracked(.resolveConflict) { await vm.resolveConflict(taking: side) }
  }

  static func telemetry(_ action: HunkAction) -> MacTelemetryEvent.GitAction {
    switch action {
    case .stageHunk: .stageHunk
    case .unstageHunk: .unstageHunk
    case .discardHunk: .discardHunk
    case .stageLines: .stageLines
    case .unstageLines: .unstageLines
    case .discardLines: .discardLines
    }
  }
}
