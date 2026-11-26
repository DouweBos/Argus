import ArgusCore
import ArgusEditor
import Foundation

/// The gutter's attribution column: a dot on lines an agent wrote, a bar on lines a person edited since.
extension CodeSession {
  /// One read for the session, then every open file takes its own lines.
  func refreshAttribution() async {
    guard let model else { return }
    if let loaded = await LineAttributionLoader.load(model.store, sessionId: sessionId, surface: .code) {
      attribution = loaded
    }
    for file in files.values { applyAttribution(file) }
  }

  /// The host numbers the lines on disk, so unsaved edits hide the marks until the save.
  func applyAttribution(_ file: CodeFile) {
    guard let document = file.document else { return }
    var marks: [Int: LineAuthor] = [:]
    if !document.isDirty {
      for (line, author) in attribution?.lines(file.path) ?? [:] { marks[line - 1] = author }
    }
    document.attribution = marks
  }
}
