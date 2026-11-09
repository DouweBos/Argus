import ArgusUI
import GroveKit
import SwiftUI

/// The selected change's diff, with hunk and line staging for its side.
struct WorkingDiffView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    if let entry = vm.selectedEntry, entry.isConflicted {
      QuietEmptyState(
        icon: "exclamationmark.triangle", title: "\(entry.fileName) has conflicts",
        message: "Pick a side or edit the merged result in Conflicts."
      ) {
        Button("Resolve in Conflicts") { model.navigate(.sessionGit(id: workspace.sessionId, view: .conflicts)) }
      }
    } else if vm.selectedEntry == nil && !vm.isDiffLoading {
      // The file list keeps only a quiet line; the diff pane says why it's empty.
      if !vm.hasLoadedStatus {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if vm.statusEntries.isEmpty {
        QuietEmptyState(icon: "checkmark.seal", title: "Nothing to commit", message: "Your working tree is clean.")
      } else {
        QuietEmptyState(icon: "doc.text.magnifyingglass", title: "Select a file", message: "Choose a file to see its changes.")
      }
    } else {
      DiffPane(
        diff: vm.currentDiff,
        path: vm.selectedEntry?.path,
        isLoading: vm.isDiffLoading,
        actions: vm.selectedEntry == nil ? nil : (vm.selectedSide == .staged ? .staged : .unstaged),
        onAction: { action, hunk, lines in
          Task { await WorkingCopyActions(workspace: workspace).hunk(action, hunk, lines) }
        },
        openLine: openLine,
        review: vm.selectedEntry.map { entry in
          DiffReviewContext.session(
            workspace.sessionId, path: entry.path,
            scope: vm.selectedSide == .staged ? "staged changes" : "uncommitted changes", store: model.store)
        },
        ignoreWhitespace: Binding(
          get: { vm.ignoreWhitespace }, set: { on in Task { await vm.setIgnoreWhitespace(on) } }),
        accessory: vm.canSwitchDiffSide ? AnyView(sidePicker) : nil
      )
    }
  }

  /// A deleted file has no lines to open.
  private var openLine: ((Int) -> Void)? {
    guard let entry = vm.selectedEntry, entry.workdirStatus != .deleted, entry.indexStatus != .deleted else { return nil }
    return { line in
      model.openCode(session: workspace.sessionId, path: entry.path, line: line, source: .diff)
    }
  }

  private var sidePicker: some View {
    HStack(spacing: 2) {
      ForEach([DiffSide.unstaged, .staged], id: \.self) { side in
        Button(side == .staged ? "Staged" : "Unstaged") {
          if side != vm.selectedSide { Task { await vm.setDiffSide(side) } }
        }
        .buttonStyle(QuietTabButtonStyle(selected: vm.selectedSide == side))
        .accessibilityAddTraits(vm.selectedSide == side ? .isSelected : [])
      }
    }
    .fixedSize()
  }
}
