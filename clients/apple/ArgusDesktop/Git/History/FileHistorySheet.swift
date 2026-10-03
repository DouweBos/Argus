import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// Every commit that touched one file, with the file's diff in each; restore
/// or export the file as it was at any of them.
struct FileHistorySheet: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let path: String
  let close: () -> Void
  @State private var history: FileHistoryViewModel
  /// A clean file restores without the view model asking, so this asks once first.
  @State private var confirmingRestore: CommitInfo?

  init(workspace: GitWorkspace, path: String, close: @escaping () -> Void) {
    self.workspace = workspace
    self.path = path
    self.close = close
    _history = State(initialValue: FileHistoryViewModel(repository: workspace.repository, filePath: path))
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider()
      if let error = history.errorMessage {
        SheetBanner(message: error, tone: .danger).padding(8)
      }
      if let restored = history.restoredCommit {
        SheetBanner(message: "Restored the file as of \(restored.shortSHA).", tone: .success).padding(8)
      }
      HSplitView {
        List(
          history.commits,
          selection: Binding(
            get: { history.selectedCommit?.id },
            set: { id in
              guard let commit = history.commits.first(where: { $0.id == id }) else { return }
              Task { await history.selectCommit(commit) }
            })
        ) { commit in
          VStack(alignment: .leading, spacing: 2) {
            Text(commit.summary).lineLimit(1)
            Text("\(commit.shortSHA) · \(commit.authorName) · \(CommitDates.full.string(from: commit.authorDate))")
              .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
          }
          .font(.system(size: 12))
          .tag(commit.id)
        }
        .overlay { if history.isLoading && history.commits.isEmpty { ProgressView().controlSize(.small) } }
        .frame(minWidth: 240, idealWidth: 300, maxWidth: 420)
        DiffPane(diff: history.fileDiff, path: path, isLoading: history.isLoadingDiff)
          .frame(minWidth: 400)
      }
    }
    .frame(width: 960, height: 640)
    .task {
      history.onRepositoryChanged = { [workspace] in await workspace.refreshAll() }
      await history.loadHistory()
    }
    .confirmationDialog(
      "Restore \((path as NSString).lastPathComponent) as of \(confirmingRestore?.shortSHA ?? "")?",
      isPresented: Binding(get: { confirmingRestore != nil }, set: { if !$0 { confirmingRestore = nil } }),
      presenting: confirmingRestore
    ) { commit in
      Button("Restore") { requestRestore(commit) }
    } message: { _ in
      Text("The working copy's version of this file is replaced; the change shows up as uncommitted.")
    }
    .confirmationDialog(
      "Overwrite your changes to \((path as NSString).lastPathComponent)?",
      isPresented: Binding(get: { history.pendingRestore != nil }, set: { if !$0 { history.cancelRestore() } })
    ) {
      Button("Restore", role: .destructive) {
        if let commit = history.pendingRestore { Task { await restore(commit) } }
      }
    } message: {
      Text("The file has uncommitted changes that restoring this version replaces.")
    }
  }

  private var header: some View {
    HStack(spacing: 8) {
      Image(systemName: "clock.arrow.circlepath").foregroundStyle(.secondary)
      Text(path).font(.system(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.head)
      Text("\(history.commits.count) commits").font(.system(size: 11)).foregroundStyle(.secondary)
      Spacer()
      Button("Blame") {
        let ref = history.selectedCommit?.id
        close()
        model.navigate(.sessionGit(id: workspace.sessionId, view: .blame(path: path, ref: ref)))
      }
      Button("Export…") { Task { await export() } }
        .disabled(history.selectedCommit == nil)
      Button("Restore This Version…") { confirmingRestore = history.selectedCommit }
      .disabled(!history.canRestoreSelected)
      Button("Done", action: close).keyboardShortcut(.cancelAction)
    }
    .controlSize(.small)
    .padding(.horizontal, 12)
    .frame(height: 40)
  }

  private func requestRestore(_ commit: CommitInfo) {
    Task {
      await history.requestRestore(commit)
      // A clean file restored straight away; a dirty one waits on the dialog.
      if history.pendingRestore == nil { workspace.track(.restoreFile, success: history.errorMessage == nil) }
    }
  }

  private func restore(_ commit: CommitInfo) async {
    await history.restore(commit)
    workspace.track(.restoreFile, success: history.errorMessage == nil)
  }

  private func export() async {
    guard let commit = history.selectedCommit else { return }
    let panel = NSSavePanel()
    let name = (path as NSString).lastPathComponent
    panel.nameFieldStringValue = "\(commit.shortSHA)-\(name)"
    guard await panel.begin() == .OK, let url = panel.url else { return }
    await history.exportFile(to: url)
  }
}
