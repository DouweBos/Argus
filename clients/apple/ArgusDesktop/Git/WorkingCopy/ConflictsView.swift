import ArgusUI
import GroveKit
import SwiftUI

/// The in-progress operation's conflicted files, each resolved by taking a
/// side or editing the merged result.
struct ConflictsView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    VStack(spacing: 0) {
      if let error = vm.errorMessage {
        GitErrorBanner(message: error) { vm.clearError() }
      }
      if vm.isInOperation {
        OperationBanner(workspace: workspace, showsConflictsLink: false)
        Divider()
      }
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .task(id: vm.conflictedFiles.map(\.path)) {
      if vm.selectedEntry?.isConflicted != true { await vm.resolveNextConflict() }
    }
  }

  @ViewBuilder
  private var content: some View {
    let conflicts = vm.conflictedFiles
    if conflicts.isEmpty {
      QuietEmptyState(
        icon: "checkmark.circle", title: vm.isInOperation ? "All conflicts resolved" : "No conflicts",
        message: vm.isInOperation ? "Continue to finish, or abort to go back." : "Nothing is waiting to be resolved."
      ) {
        if !vm.isInOperation {
          Button("Back to Working Copy") { model.navigate(.sessionGit(id: workspace.sessionId, view: .working)) }
        }
      }
    } else {
      ResizableHSplit(key: "git.conflicts", leadingMin: 160, leadingIdeal: 220, leadingMax: 400, trailingMin: 320) {
        List(conflicts, selection: selection) { entry in
          // A button so the click lands even before the window is key.
          Button {
            Task { await vm.select(entry) }
          } label: {
            HStack(spacing: 6) {
              FileTypeIcon(path: entry.path)
              Text(entry.fileName).lineLimit(1)
              Text(entry.directory).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
              Spacer(minLength: 0)
              FileStatusBadge(status: .conflicted)
            }
            .contentShape(.rect)
          }
          .buttonStyle(.plain)
          .font(.scaled(size: 12))
          .help(entry.path)
          .tag(entry.path)
        }
        .navigatorList()
      } trailing: {
        if let entry = vm.selectedEntry, entry.isConflicted {
          ConflictDetailView(workspace: workspace, entry: entry)
            .id(entry.path)
        } else {
          QuietEmptyState(icon: "exclamationmark.triangle", title: "Select a conflicted file")
        }
      }
    }
  }

  private var selection: Binding<String?> {
    Binding(
      get: { vm.selectedEntry?.isConflicted == true ? vm.selectedEntry?.path : nil },
      set: { path in
        guard let entry = vm.conflictedFiles.first(where: { $0.path == path }) else { return }
        Task { await vm.select(entry) }
      })
  }
}
