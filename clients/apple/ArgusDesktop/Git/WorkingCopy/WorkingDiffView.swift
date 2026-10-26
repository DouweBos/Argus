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
      EmptyState(
        icon: "exclamationmark.triangle", title: "\(entry.fileName) has conflicts",
        body: "Pick a side or edit the merged result in Conflicts."
      ) {
        Button("Resolve in Conflicts") { model.navigate(.sessionGit(id: workspace.sessionId, view: .conflicts)) }
      }
    } else if vm.selectedEntry == nil && !vm.isDiffLoading {
      // Grove's empty states; the file list keeps only a quiet line.
      if !vm.hasLoadedStatus {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if vm.statusEntries.isEmpty {
        EmptyState(icon: "checkmark.seal", title: "Nothing to Commit", body: "Your working tree is clean.")
      } else {
        EmptyState(icon: "doc.text.magnifyingglass", title: "Select a File", body: "Choose a file to see its changes.")
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
    Picker(
      "Side",
      selection: Binding(get: { vm.selectedSide }, set: { side in Task { await vm.setDiffSide(side) } })
    ) {
      Text("Unstaged").tag(DiffSide.unstaged)
      Text("Staged").tag(DiffSide.staged)
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .controlSize(.small)
    .fixedSize()
  }
}
