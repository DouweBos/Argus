import ArgusCore
import ArgusEditor
import Foundation
import GroveKit

/// The git gutter (buffer against `HEAD`), reverting one of its hunks, and the
/// session's changed files for the navigator.
extension CodeSession {
  /// The session's repository, as the git panel opens it.
  func gitWorkspace() async -> GitWorkspace? {
    guard let model, let session = model.session(sessionId) else { return nil }
    for _ in 0..<100 {
      if let workspace = await model.git.open(session) { return workspace }
      guard case .opening = model.git.slots[sessionId] else { return nil }
      try? await Task.sleep(for: .milliseconds(100))
    }
    return nil
  }

  /// Changed files, as the git panel's working copy lists them.
  var changedEntries: [StatusEntry] {
    model?.git.workspace(sessionId)?.workingCopy.statusEntries ?? []
  }

  /// Reads `HEAD`'s copy for the gutter: empty for a file `HEAD` doesn't have yet.
  func refreshGitBase(_ file: CodeFile) async {
    guard let workspace = await gitWorkspace() else { return }
    let entry = workspace.workingCopy.statusEntries.first { $0.path == file.path }
    if entry?.workdirStatus == .untracked || entry?.indexStatus == .added {
      file.gitBase = ""
    } else {
      file.gitBase = try? await workspace.repository.fileContents(path: file.path, revision: "HEAD")
    }
    recomputeGutter(file)
  }

  /// 300 ms after the last edit.
  func scheduleGutter(_ file: CodeFile) {
    file.gutterTask?.cancel()
    file.gutterTask = Task { [weak self, weak file] in
      try? await Task.sleep(for: .milliseconds(300))
      guard !Task.isCancelled, let self, let file else { return }
      self.recomputeGutter(file)
    }
  }

  private func recomputeGutter(_ file: CodeFile) {
    guard let document = file.document else { return }
    guard let base = file.gitBase else {
      file.hunks = nil
      if !document.gitMarks.isEmpty { document.gitMarks = [] }
      return
    }
    let hunks = CodeHunks(base: base, current: document.text)
    file.hunks = hunks
    let marks = hunks.marks
    if marks != document.gitMarks { document.gitMarks = marks }
  }

  /// `git_status_changed` and friends: `HEAD` may have moved, files appeared or went.
  func gitStatusChanged() {
    markFileListStale()
    gitRefresh?.cancel()
    gitRefresh = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(500))
      guard !Task.isCancelled, let self else { return }
      if let workspace = model?.git.workspace(sessionId), !workspace.isActive {
        await workspace.workingCopy.refresh()
      }
      for file in files.values where file.document != nil { await refreshGitBase(file) }
      if navigatorMode == .files || quickOpenVisible { await loadFileList() }
    }
  }

  /// Revert Hunk from the gutter. A clean buffer equals the disk, so git takes the hunk back
  /// out of the file (`discard_hunk`) and the reload follows; with unsaved edits the patch
  /// can't match the disk, so the base lines go back into the buffer as an undoable edit.
  func revertHunk(_ mark: GutterMark, in path: String) async {
    guard let file = files[path], let document = file.document, let hunks = file.hunks,
      let hunk = hunks.hunk(for: mark)
    else { return }
    if !document.isDirty, let patch = hunks.patch(for: hunk, path: path), let store {
      do {
        try await store.request(
          ArgusProtocol.Commands.DiscardHunk.self, .init(id: sessionId, patch: patch), session: sessionId)
        await reloadFromDisk(file, external: false)
        return
      } catch {
        // The disk moved since the gutter was drawn; fall back to the buffer.
      }
    }
    let edit = CodeHunks.edit(from: document.text, to: hunks.reverting(hunk))
    let start = document.position(of: edit.range.location)
    let end = document.position(of: edit.range.location + edit.range.length)
    document.apply(edits: [(EditorRange(start: start, end: end), edit.text)])
  }
}
