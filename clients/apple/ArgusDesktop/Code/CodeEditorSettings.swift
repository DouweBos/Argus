import ArgusCore
import ArgusEditor
import Foundation

/// The editor's app settings, as `AppPreferences` keeps them.
struct CodeEditorSettings: Equatable {
  var fontName: String?
  var fontSize: Double = 13
  var tabWidth = 4
  var insertSpaces = true
  var wrapLines = false
  var showInvisibles = false

  /// The app settings with `.editorconfig` laid over them: the file wins wherever it says something.
  func configuration(applying properties: EditorConfig.Properties) -> EditorConfiguration {
    var configuration = EditorConfiguration(
      fontName: fontName, fontSize: CGFloat(fontSize), tabWidth: tabWidth, insertSpaces: insertSpaces,
      wrapLines: wrapLines, showInvisibles: showInvisibles)
    if let style = properties.indentStyle { configuration.insertSpaces = style == .space }
    // Spaces indent by `indent_size`; a tab is as wide as `tab_width`.
    let width =
      configuration.insertSpaces
      ? properties.indentSize ?? properties.tabWidth : properties.tabWidth ?? properties.indentSize
    if let width, width > 0 { configuration.tabWidth = width }
    if let trim = properties.trimTrailingWhitespace { configuration.trimTrailingWhitespaceOnSave = trim }
    if let final = properties.insertFinalNewline { configuration.insertFinalNewline = final }
    return configuration
  }
}

/// `.editorconfig` files up the tree from a file, read through the host and cached per directory.
@MainActor
final class EditorConfigCache {
  /// Directory (worktree-relative, `""` for the root) → the file's text, or nil when there is none.
  private var files: [String: String?] = [:]
  private let read: (String) async -> String?

  init(read: @escaping (String) async -> String?) {
    self.read = read
  }

  /// The properties for `path`, nearest file first, stopping at `root = true`.
  func properties(for path: String) async -> EditorConfig.Properties {
    var chain: [(directory: String, text: String)] = []
    for directory in Self.directories(above: path) {
      if files[directory] == nil {
        let file = directory.isEmpty ? ".editorconfig" : "\(directory)/.editorconfig"
        files[directory] = .some(await read(file))
      }
      guard case .some(.some(let text)) = files[directory] else { continue }
      chain.append((directory, text))
      if EditorConfig(parsing: text).isRoot { break }
    }
    return EditorConfig.resolve(path: path, files: chain)
  }

  /// A `.editorconfig` was saved or changed on disk.
  func invalidate() { files = [:] }

  /// `a/b/c.swift` → `a/b`, `a`, `""`.
  nonisolated static func directories(above path: String) -> [String] {
    var parts = path.split(separator: "/").dropLast().map(String.init)
    var result: [String] = []
    while true {
      result.append(parts.joined(separator: "/"))
      guard !parts.isEmpty else { return result }
      parts.removeLast()
    }
  }
}
