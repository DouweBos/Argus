import ArgusUI
import GroveKit
import SwiftUI

/// The working copy's confirmations: discarding files, hunks or lines,
/// renaming and moving to the Trash.
struct WorkingCopyDialogs: ViewModifier {
  let workspace: GitWorkspace
  @Binding var pendingDiscardAction: HunkAction?

  private var vm: WorkingCopyViewModel { workspace.workingCopy }
  private var actions: WorkingCopyActions { WorkingCopyActions(workspace: workspace) }

  func body(content: Content) -> some View {
    content
      .confirmationDialog(
        discardTitle, isPresented: present(vm.pendingDiscard != nil) { vm.cancelDiscard() },
        titleVisibility: .visible, presenting: vm.pendingDiscard
      ) { entries in
        Button("Discard", role: .destructive) { Task { await actions.discard(entries) } }
        Button("Cancel", role: .cancel) { vm.cancelDiscard() }
      } message: { _ in
        Text("Uncommitted changes are lost; untracked files are deleted. This can't be undone.")
      }
      .confirmationDialog(
        vm.pendingHunkDiscard?.title ?? "", isPresented: present(vm.pendingHunkDiscard != nil) { vm.cancelHunkDiscard() },
        titleVisibility: .visible, presenting: vm.pendingHunkDiscard
      ) { pending in
        Button("Discard", role: .destructive) { confirm(pending, dontAskAgain: false) }
        Button("Discard and Don't Ask Again", role: .destructive) { confirm(pending, dontAskAgain: true) }
        Button("Cancel", role: .cancel) { vm.cancelHunkDiscard() }
      } message: { _ in
        Text("The changes are removed from the working tree. This can't be undone.")
      }
      .confirmationDialog(
        trashTitle, isPresented: present(trashEntries != nil) { vm.cancelFileAction() },
        titleVisibility: .visible, presenting: trashEntries
      ) { entries in
        Button("Move to Trash", role: .destructive) { Task { await vm.moveToTrash(entries) } }
        Button("Cancel", role: .cancel) { vm.cancelFileAction() }
      } message: { entries in
        Text("You can restore \(entries.count == 1 ? "it" : "them") from the Trash in Finder.")
      }
      .sheet(item: renameEntry) { entry in
        RenameFileSheet(entry: entry) { newPath in
          Task { await vm.rename(entry, to: newPath) }
        } onCancel: {
          vm.cancelFileAction()
        }
      }
  }

  private func confirm(_ pending: PendingHunkDiscard, dontAskAgain: Bool) {
    let action = pendingDiscardAction
    Task { await actions.confirmHunkDiscard(pending, action: action, dontAskAgain: dontAskAgain) }
  }

  private func present(_ shown: Bool, dismiss: @escaping () -> Void) -> Binding<Bool> {
    Binding(get: { shown }, set: { if !$0 { dismiss() } })
  }

  private var discardTitle: String {
    guard let entries = vm.pendingDiscard else { return "" }
    return entries.count == 1 ? "Discard changes to “\(entries[0].fileName)”?" : "Discard changes to \(entries.count) files?"
  }

  private var trashEntries: [StatusEntry]? {
    if case .delete(let entries) = vm.pendingFileAction { return entries }
    return nil
  }

  private var trashTitle: String {
    guard let entries = trashEntries else { return "" }
    return entries.count == 1 ? "Move “\(entries[0].fileName)” to the Trash?" : "Move \(entries.count) files to the Trash?"
  }

  private var renameEntry: Binding<StatusEntry?> {
    Binding(
      get: {
        if case .rename(let entry) = vm.pendingFileAction { return entry }
        return nil
      }, set: { if $0 == nil { vm.cancelFileAction() } })
  }
}

/// A repository-relative path, so a rename can also move the file.
private struct RenameFileSheet: View {
  let entry: StatusEntry
  let onRename: (String) -> Void
  let onCancel: () -> Void
  @State private var newPath = ""

  private var trimmed: String { newPath.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Rename \(entry.fileName)").font(.headline)
      Text(
        entry.workdirStatus == .untracked
          ? "Include folders in the path to move the file."
          : "Tracked files are renamed with git mv, so the rename is staged."
      )
      .font(.system(size: 12))
      .foregroundStyle(.secondary)
      TextField("New path", text: $newPath)
        .textFieldStyle(.roundedBorder)
        .font(.system(size: 12, design: .monospaced))
        .onSubmit { if isValid { onRename(trimmed) } }
      HStack {
        Spacer()
        Button("Cancel", role: .cancel, action: onCancel).keyboardShortcut(.cancelAction)
        Button("Rename") { onRename(trimmed) }
          .keyboardShortcut(.defaultAction)
          .disabled(!isValid)
      }
    }
    .padding(20)
    .frame(width: 440)
    .onAppear { newPath = entry.path }
  }

  private var isValid: Bool { !trimmed.isEmpty && trimmed != entry.path && !trimmed.hasSuffix("/") }
}
