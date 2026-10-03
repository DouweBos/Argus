import ArgusUI
import GroveKit
import SwiftUI

/// A merge, rebase, cherry-pick or revert is in progress: what, the conflicts
/// left, and Continue / Abort.
struct OperationBanner: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  /// Off on the Conflicts view itself.
  var showsConflictsLink = true
  @State private var confirmingAbort = false

  private var vm: WorkingCopyViewModel { workspace.workingCopy }
  private var actions: WorkingCopyActions { WorkingCopyActions(workspace: workspace) }

  var body: some View {
    let conflicts = vm.conflictedFiles.count
    HStack(spacing: 10) {
      Image(systemName: "arrow.triangle.merge").foregroundStyle(theme.warning)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.system(size: 12, weight: .semibold))
        Text(detail(conflicts: conflicts)).font(.system(size: 11)).foregroundStyle(.secondary)
      }
      Spacer()
      if vm.isRunningOperation { ProgressView().controlSize(.small) }
      if showsConflictsLink, conflicts > 0 {
        Button("Resolve Conflicts") { model.navigate(.sessionGit(id: workspace.sessionId, view: .conflicts)) }
      }
      Button("Abort…") { confirmingAbort = true }
        .disabled(vm.isRunningOperation)
      Button("Continue") { Task { await actions.continueOperation() } }
        .buttonStyle(.borderedProminent)
        .disabled(vm.isRunningOperation || conflicts > 0)
        .help(conflicts > 0 ? "Resolve every conflict first" : "Continue the \(noun)")
    }
    .controlSize(.small)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(theme.warningSoft)
    .confirmationDialog("Abort the \(noun)?", isPresented: $confirmingAbort, titleVisibility: .visible) {
      Button("Abort", role: .destructive) { Task { await actions.abortOperation() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("The repository goes back to how it was before the \(noun) started; resolved files are lost.")
    }
  }

  private var noun: String {
    switch vm.repositoryState {
    case .merge: "merge"
    case .rebase, .rebaseInteractive: "rebase"
    case .cherrypick: "cherry-pick"
    case .revert: "revert"
    case .normal, .bisect: "operation"
    }
  }

  private var title: String {
    if vm.pendingRestack != nil { return "Restacking branches" }
    guard let context = vm.operationContext else { return "\(noun.prefix(1).uppercased())\(noun.dropFirst()) in progress" }
    switch vm.repositoryState {
    case .rebase, .rebaseInteractive: return "Rebasing \(context.theirsLabel) onto \(context.oursLabel)"
    case .cherrypick: return "Cherry-picking \(context.theirsLabel) onto \(context.oursLabel)"
    case .revert: return "Reverting \(context.theirsLabel) on \(context.oursLabel)"
    default: return "Merging \(context.theirsLabel) into \(context.oursLabel)"
    }
  }

  private func detail(conflicts: Int) -> String {
    conflicts == 0
      ? "All conflicts resolved — continue to finish the \(noun)."
      : "\(conflicts) conflicted \(conflicts == 1 ? "file" : "files") left."
  }
}
