import ArgusEditor
import ArgusSyntax
import ArgusUI
import SwiftUI

/// Under the editor: what the file is highlighted as (or why it isn't), where
/// the caret is, indentation and line endings, then whatever the language-server
/// layer adds through `CodeStore.statusBarAccessory`.
struct CodeStatusBar: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let code: CodeSession
  let file: CodeFile
  let document: EditorDocument

  var body: some View {
    HStack(spacing: 14) {
      Text(language).help(languageHelp)
      if file.isSaving { ProgressView().controlSize(.mini) }
      Spacer(minLength: 8)
      if let accessory = model.code.statusBarAccessory { accessory(code, file) }
      Text("Ln \(document.caret.line + 1), Col \(document.caret.utf16Column + 1)")
        .monospacedDigit()
      if let format = file.format, format.formatter != .none { CodeFormatterItem(status: format) }
      Text(document.configuration.insertSpaces ? "Spaces: \(document.configuration.tabWidth)" : "Tab Size: \(document.configuration.tabWidth)")
      Text(file.eol == .crlf ? "CRLF" : "LF")
    }
    .font(.scaled(size: 11))
    .foregroundStyle(theme.textSecondary)
    .lineLimit(1)
    .padding(.horizontal, 10)
    .frame(height: 24)
    .background(theme.bgSecondary)
  }

  private var language: String {
    switch document.highlightStatus {
    case .highlighted(let language): language.displayName
    case .plainText: file.language?.displayName ?? "Plain Text"
    case .disabled(let reason):
      "\(file.language?.displayName ?? "Plain Text") — highlighting off (\(Self.describe(reason)))"
    }
  }

  private var languageHelp: String {
    switch document.highlightStatus {
    case .highlighted: "Highlighted with the bundled grammar"
    case .plainText: file.language == nil ? "No grammar covers this file" : "This language's grammar isn't available"
    case .disabled(let reason): "Highlighting is off: \(Self.describe(reason))"
    }
  }

  static func describe(_ reason: SyntaxLimits.DisabledReason) -> String {
    switch reason {
    case .tooLarge: "file over 2 MB"
    case .longLines: "very long lines"
    }
  }
}

/// The project's formatter next to indentation; amber with the reason when its last run failed.
struct CodeFormatterItem: View {
  @Environment(\.theme) private var theme
  let status: CodeFormatStatus

  var body: some View {
    if let error = status.error {
      Label(status.name, systemImage: "exclamationmark.triangle.fill")
        .foregroundStyle(theme.warning)
        .help("\(status.name) didn't format this file; it was saved as typed.\n\(error)")
    } else {
      Text(status.name).help("Formats with the project's \(status.name) (⇧⌥F, and on save)")
    }
  }
}
