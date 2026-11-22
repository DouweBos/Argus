import ArgusKit
import ArgusUI
import GroveKit
import SwiftUI

/// One conflicted file: ours beside theirs, each takeable whole, over the
/// merged result as it sits in the working tree, markers and all.
struct ConflictDetailView: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let entry: StatusEntry
  @State private var merged = ""
  @State private var result = ConflictResult.loading
  @State private var isSaving = false

  private var vm: WorkingCopyViewModel { workspace.workingCopy }
  private var hasMarkers: Bool {
    merged.contains("<<<<<<< ") || merged.contains(">>>>>>> ")
  }

  var body: some View {
    ResizableVSplit(key: "git.conflict.merged", topMin: 140, bottomMin: 180, bottomIdeal: 320, showsBottom: true) {
      // Two even halves that narrow with the window, unlike an HSplitView.
      HStack(spacing: 0) {
        side(.ours, label: vm.operationContext?.oursLabel ?? "HEAD", text: vm.conflictVersions?.ours)
          .frame(maxWidth: .infinity)
        Divider()
        side(.theirs, label: vm.operationContext?.theirsLabel ?? "Incoming", text: vm.conflictVersions?.theirs)
          .frame(maxWidth: .infinity)
      }
    } bottom: {
      mergedEditor
    }
    .task(id: entry.path) { await load() }
  }

  private func side(_ side: ConflictSide, label: String, text: String?) -> some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        Text(side == .ours ? "Ours" : "Theirs").font(.scaled(size: 12, weight: .semibold))
        Text(label).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
        Spacer()
        Button(side == .ours ? "Take Ours" : "Take Theirs") {
          Task { await WorkingCopyActions(workspace: workspace).resolve(taking: side) }
        }
        .controlSize(.small)
        .disabled(isSaving || vm.isDiffLoading)
      }
      .padding(.horizontal, 10)
      .frame(height: 32)
      Divider()
      if let text {
        ConflictTextView(text: .constant(text), isEditable: false)
      } else if vm.isDiffLoading {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        QuietEmptyState(icon: "trash", title: "Deleted on this side")
      }
    }
    .frame(minWidth: 200)
  }

  private var mergedEditor: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        Text("Result").font(.scaled(size: 12, weight: .semibold))
        Text(entry.path).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(.secondary)
          .lineLimit(1).truncationMode(.head)
        Spacer()
        if hasMarkers {
          Image(systemName: "exclamationmark.triangle.fill")
            .foregroundStyle(theme.warning)
            .help("Conflict markers are still in the result")
            .accessibilityLabel("Conflict markers left")
        }
        Button("Revert") { Task { await load() } }
          .disabled(result.text == nil || merged == result.text || isSaving)
        Button("Save & Mark Resolved") { Task { await save() } }
          .buttonStyle(.borderedProminent)
          .disabled(isSaving || result.text == nil)
      }
      .controlSize(.small)
      .padding(.horizontal, 10)
      .frame(height: 32)
      Divider()
      switch result {
      case .loading:
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      case .loaded:
        ConflictTextView(text: $merged)
      case .unreadable(let reason):
        QuietEmptyState(icon: "exclamationmark.triangle", title: "Couldn't read the result", message: reason) {
          Button("Try Again") { Task { await load() } }
        }
      }
    }
  }

  private func load() async {
    result = .loading
    let read = await ConflictResult.read(entry.path, in: workspace.repository.path, runner: workspace.runner)
    guard !Task.isCancelled else { return }
    merged = read.text ?? ""
    result = read
  }

  /// Writes through the host, which keeps writes inside the worktree, then stages it.
  private func save() async {
    guard result.text != nil else { return }
    isSaving = true
    defer { isSaving = false }
    let id = workspace.sessionId
    let written = await workspace.host(
      ArgusProtocol.Commands.GitWriteConflictMerged.self,
      .init(id: id, filePath: entry.path, contents: merged), label: "Saving \(entry.fileName)")
    guard written != nil else { return workspace.track(.resolveConflict, success: false) }
    await workspace.host(
      ArgusProtocol.Commands.GitMarkResolved.self, .init(id: id, filePath: entry.path),
      label: "Marking \(entry.fileName) resolved", track: .resolveConflict)
    await vm.resolveNextConflict()
  }
}
