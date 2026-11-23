import ArgusCore
import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// The selected change's diff, with hunk and line staging for its side.
struct WorkingDiffView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  var viewed: ViewedFiles?

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  /// The kit shows conflicts and the empty states itself; this is only ever asked for a picked file's diff.
  var body: some View {
    DiffPane(
      diff: vm.currentDiff,
      path: vm.selectedEntry?.path,
      isLoading: vm.isDiffLoading,
      staging: staging,
      sideSwitch: sideSwitch,
      openLine: openLine,
      review: vm.selectedEntry.map { entry in
        DiffReviewContext.session(
          workspace.sessionId, path: entry.path,
          scope: vm.selectedSide == .staged ? "staged changes" : "uncommitted changes", store: model.store)
      },
      ignoreWhitespace: Binding(
        get: { vm.ignoreWhitespace }, set: { on in Task { await vm.setIgnoreWhitespace(on) } }),
      images: images,
      accessory: accessory
    )
    // An edit to the shown file can turn its mark to changed.
    .task(id: vm.currentDiff?.stats) { await viewed?.load() }
  }

  private var accessory: AnyView? {
    vm.selectedEntry.flatMap { entry in viewed.map { AnyView(ViewedCheckbox(viewed: $0, path: entry.path)) } }
  }

  private var staging: GitDiffStaging? {
    guard let entry = vm.selectedEntry,
      (vm.selectedSide == .staged ? entry.indexStatus : entry.workdirStatus).supportsHunkActions
    else { return nil }
    return GitDiffStaging(side: vm.selectedSide) { [vm] action, hunk, lines in
      Task {
        vm.clearError()
        await vm.performHunkAction(action, hunk: hunk, lines: lines)
      }
    }
  }

  private var sideSwitch: GitDiffSideSwitch? {
    guard vm.selectedEntry != nil, vm.canSwitchDiffSide else { return nil }
    return GitDiffSideSwitch(side: vm.selectedSide) { side in Task { await vm.setDiffSide(side) } }
  }

  private var images: GitDiffImages {
    let staged = vm.selectedSide == .staged
    return GitDiffImages(
      repository: vm.repository, old: staged ? .commit("HEAD") : .index, new: staged ? .index : .workingTree,
      reloadToken: vm.diffLoadCount)
  }

  /// A deleted file has no lines to open.
  private var openLine: (@MainActor @Sendable (Int) -> Void)? {
    guard let entry = vm.selectedEntry, entry.workdirStatus != .deleted, entry.indexStatus != .deleted else { return nil }
    let sessionId = workspace.sessionId
    let path = entry.path
    return { [model] line in
      model.openCode(session: sessionId, path: path, line: line, source: .diff)
    }
  }
}
