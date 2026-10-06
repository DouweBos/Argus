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
      ContentUnavailableView {
        Label("\(entry.fileName) has conflicts", systemImage: "exclamationmark.triangle")
      } description: {
        Text("Pick a side or edit the merged result in Conflicts.")
      } actions: {
        Button("Resolve in Conflicts") { model.navigate(.sessionGit(id: workspace.sessionId, view: .conflicts)) }
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
        ignoreWhitespace: Binding(
          get: { vm.ignoreWhitespace }, set: { on in Task { await vm.setIgnoreWhitespace(on) } }),
        accessory: vm.canSwitchDiffSide ? AnyView(sidePicker) : nil
      )
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
