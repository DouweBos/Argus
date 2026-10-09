import ArgusCore
import ArgusEditor
import Foundation

/// Format Document (⇧⌥F) and format on save, through `CodeStore.formatting`.
extension CodeSession {
  /// Runs the format chain on an open file; the status bar learns how it went.
  @discardableResult
  func format(_ path: String, trigger: CodeFormatting.Trigger) async -> CodeFormatOutcome {
    guard let file = files[path], let document = file.document, let formatting = store?.formatting else {
      return CodeFormatOutcome()
    }
    let outcome = await formatting.format(session: sessionId, path: path, document: document, trigger: trigger)
    if let status = outcome.status { file.format = status }
    return outcome
  }

  /// Which formatter covers a file that just opened, for the status bar and Automatic.
  func detectFormatter(_ file: CodeFile) async {
    guard let formatting = store?.formatting else { return }
    let status = await formatting.detect(session: sessionId, path: file.path)
    guard files[file.path] === file else { return }
    file.format = status
  }
}

extension DesktopModel {
  /// ⇧⌥F on the file the code view shows.
  func formatActiveCodeDocument() {
    guard case .sessionCode(let id, let path?, _) = route, let code = code.sessions[id] else { return }
    Task { await code.format(path, trigger: .command) }
  }
}
