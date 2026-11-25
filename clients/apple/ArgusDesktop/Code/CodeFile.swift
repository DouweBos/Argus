import ArgusCore
import ArgusEditor
import ArgusSyntax
import Foundation
import Observation

/// One open file in a session's code view: its buffer once read, and where
/// that buffer stands against the disk and `HEAD`.
@MainActor
@Observable
final class CodeFile {
  enum Phase {
    case loading
    case ready(EditorDocument)
    /// A PDF or an image, shown rather than edited.
    case binary(Data)
    /// Too large to edit: read a page at a time.
    case large(LargeFilePager)
    /// Binary, or not UTF-8: offered to another app instead.
    case readOnly(ArgusProtocol.CodeReadOnlyReason)
    case failed(String)
  }

  let path: String
  var phase: Phase = .loading
  /// What renders instead of the text: Markdown next to it, a PDF or an image in its place.
  let preview: FilePreviewKind?
  /// A Markdown tab's text, page, or both.
  var markdownMode: MarkdownViewMode
  /// `mac_preview_opened` once per tab.
  @ObservationIgnored var reportedPreview = false
  var disk = CodeDiskState(baseHash: nil)
  var eol: ArgusProtocol.CodeFileEol = .lf
  var language: SyntaxLanguage?
  var isSaving = false
  /// The project's formatter for this file, once asked; `formatter == .none` when it has none.
  var format: CodeFormatStatus?
  /// Disk on the left, the buffer on the right, while Compare is open.
  var comparison: CodeHunks?
  /// `HEAD`'s text, for the gutter; nil when unknown, `""` for a file `HEAD` doesn't have.
  @ObservationIgnored var gitBase: String?
  /// The buffer against `gitBase`, as of `hunksVersion` of the document.
  var hunks: CodeHunks?
  @ObservationIgnored var hunksVersion: Int?
  /// `gitBase`'s blame; nil until it arrives, or for a file `HEAD` doesn't have.
  var blame: BlameIndex?
  @ObservationIgnored var editorConfig = EditorConfig.Properties()
  @ObservationIgnored var gutterTask: Task<Void, Never>?
  /// The buffer holds its actions weakly.
  @ObservationIgnored var actions: CodeEditorActions?
  /// A line to reveal once the buffer exists.
  @ObservationIgnored var pendingLine: Int?
  /// `mac_editor_external_reload` is sampled: once per file per session.
  @ObservationIgnored var reportedExternalReload = false

  init(path: String) {
    self.path = path
    preview = FilePreviewKind.of(path: path)
    markdownMode = AppPreferences.shared.markdownOpensIn
  }

  var document: EditorDocument? {
    if case .ready(let document) = phase { return document }
    return nil
  }

  var isDirty: Bool { document?.isDirty ?? false }

  /// Who last changed `line`, for the status bar and the inline annotation. Nil while unknown, and
  /// between an edit and the gutter catching up with it.
  func lineBlame(_ line: Int) -> LineBlame? {
    guard let document, let hunks, hunksVersion == document.version else { return nil }
    return LineBlame.of(line: line, hunks: hunks.hunks, index: blame)
  }
  var name: String { (path as NSString).lastPathComponent }
}
