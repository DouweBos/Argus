import ArgusEditor
import ArgusSyntax
import Foundation

/// The code view's telemetry enums; the cases are in `MacTelemetryEvent`.
extension MacTelemetryEvent {
  /// Where a file was opened from.
  enum EditorOpenSource: String {
    case chatLink = "chat_link"
    case diff
    case blame
    case changes
    case tree
    case quickOpen = "quick_open"
    case search
    case diagnostic
    case definition
    /// A symbol picked in quick open.
    case symbol
    /// Back/forward, a restored tab, a deep link: no click opened it.
    case history
  }

  enum EditorQuickOpenMode: String {
    case files
    case mixed
    case symbols
    case fileSymbols = "file_symbols"
    case line
  }

  enum EditorQuickOpenResult: String {
    case opened
    case dismissed
  }

  /// What formatted a save: the project's own tool, the language server, or nothing.
  enum EditorFormatter: String {
    case prettier
    case swiftformat
    case swiftFormat = "swift_format"
    case lsp
    case other
    case none
  }

  enum EditorConflictAction: String {
    case compare
    case keepMine = "keep_mine"
    case reload
  }

  enum EditorSearchScope: String {
    case file
    case worktree
  }

  enum EditorAskSource: String {
    case diagnostic
    case selection
  }

  /// A grammar's name, or `other` for a file none covers.
  static func languageName(_ language: SyntaxLanguage?) -> String {
    language?.telemetryName ?? "other"
  }

  static func fileSizeBucket(_ bytes: Int) -> String {
    switch bytes {
    case ..<10_000: "<10k"
    case ..<100_000: "<100k"
    case ..<1_000_000: "<1m"
    default: "1m+"
    }
  }
}

extension EditorCommand {
  /// `toggleLineComment` → `toggle_line_comment`.
  var telemetryName: String {
    rawValue.reduce(into: "") { name, character in
      if character.isUppercase { name += "_" + character.lowercased() } else { name.append(character) }
    }
  }
}
