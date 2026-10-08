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
    /// Too large, binary, or not UTF-8: offered to another app instead.
    case readOnly(ArgusProtocol.CodeReadOnlyReason)
    case failed(String)
  }

  let path: String
  var phase: Phase = .loading
  var disk = CodeDiskState(baseHash: nil)
  var eol: ArgusProtocol.CodeFileEol = .lf
  var language: SyntaxLanguage?
  var isSaving = false
  /// Disk on the left, the buffer on the right, while Compare is open.
  var comparison: CodeHunks?
  /// `HEAD`'s text, for the gutter; nil when unknown, `""` for a file `HEAD` doesn't have.
  @ObservationIgnored var gitBase: String?
  @ObservationIgnored var hunks: CodeHunks?
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
  }

  var document: EditorDocument? {
    if case .ready(let document) = phase { return document }
    return nil
  }

  var isDirty: Bool { document?.isDirty ?? false }
  var name: String { (path as NSString).lastPathComponent }
}
