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
  @State private var loaded: String?
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
    .task(id: entry.path) { load() }
  }

  private func side(_ side: ConflictSide, label: String, text: String?) -> some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        Text(side == .ours ? "Ours" : "Theirs").font(.system(size: 12, weight: .semibold))
        Text(label).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
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
        ContentUnavailableView("Deleted on this side", systemImage: "trash")
      }
    }
    .frame(minWidth: 200)
  }

  private var mergedEditor: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        Text("Result").font(.system(size: 12, weight: .semibold))
        Text(entry.path).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
          .lineLimit(1).truncationMode(.head)
        Spacer()
        if hasMarkers {
          Image(systemName: "exclamationmark.triangle.fill")
            .foregroundStyle(theme.warning)
            .help("Conflict markers are still in the result")
            .accessibilityLabel("Conflict markers left")
        }
        Button("Revert", action: load)
          .disabled(merged == loaded)
        Button("Save & Mark Resolved") { Task { await save() } }
          .buttonStyle(.borderedProminent)
          .disabled(isSaving || loaded == nil)
      }
      .controlSize(.small)
      .padding(.horizontal, 10)
      .frame(height: 32)
      Divider()
      ConflictTextView(text: $merged)
    }
  }

  private func load() {
    let url = workspace.repository.path.appendingPathComponent(entry.path)
    let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    merged = text
    loaded = text
  }

  /// Writes through the host, which keeps writes inside the worktree, then stages it.
  private func save() async {
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
