import ArgusCore
import ArgusEditor
import ArgusSyntax
import Foundation

/// What a buffer asks of the app: hand code to the session's agent, revert a
/// gutter hunk, open a location, count an accepted completion. One per open file.
@MainActor
final class CodeEditorActions: EditorActions {
  private weak var session: CodeSession?
  private let path: String

  init(session: CodeSession, path: String) {
    self.session = session
    self.path = path
  }

  func askAgentToFix(_ diagnostic: EditorDiagnostic) {
    let line = diagnostic.range.start.line + 1
    let kind =
      switch diagnostic.severity {
      case .error: "error"
      case .warning: "warning"
      case .info, .hint: "issue"
      }
    let source = diagnostic.source.map { " (\($0))" } ?? ""
    prefill("\(Self.mention(path, lines: line...line))\nFix this \(kind)\(source): \(diagnostic.message)", source: .diagnostic)
  }

  func sendSelectionToAgent(text: String, range: EditorRange) {
    let end = range.end.utf16Column == 0 && range.end.line > range.start.line ? range.end.line : range.end.line + 1
    let fence = String(repeating: "`", count: max(3, Self.longestBacktickRun(in: text) + 1))
    let language = SyntaxLanguage.detect(path: path, firstLine: nil)?.rawValue ?? ""
    let body = "\(Self.mention(path, lines: (range.start.line + 1)...max(range.start.line + 1, end)))\n\(fence)\(language)\n\(text)\n\(fence)\n"
    prefill(body, source: .selection)
  }

  func revertHunk(_ mark: GutterMark) {
    guard let session else { return }
    Task { await session.revertHunk(mark, in: path) }
  }

  /// Go to definition. A location in another project comes back absolute: it opens in its default app.
  func open(_ location: EditorLocation) {
    guard let session else { return }
    if location.relativePath.hasPrefix("/") {
      Task { await session.openAbsolute(location.relativePath) }
    } else {
      session.navigate(to: location.relativePath, line: location.range.start.line + 1, source: .definition)
    }
  }

  func completionAccepted() {
    let language = session?.files[path]?.language
    MacTelemetry.capture(.editorCompletionAccepted(language: MacTelemetryEvent.languageName(language)))
  }

  // MARK: Chat

  /// Puts `text` at the end of the session's agent's draft and shows its input, never sending.
  /// With no live agent, starts one first.
  private func prefill(_ text: String, source: MacTelemetryEvent.EditorAskSource) {
    guard let session, let model = session.model else { return }
    let sessionId = session.sessionId
    Task {
      var agentId = Self.liveAgent(in: sessionId, model: model)
      let started = agentId == nil
      if agentId == nil { agentId = await model.startAgent(sessionId: sessionId) }
      guard let agentId else { return }
      MacTelemetry.capture(.editorAskAgent(source: source, startedAgent: started))
      let preferences = Preferences()
      let key = PreferenceKey.draft(agentId: agentId)
      let draft = preferences.string(key) ?? ""
      preferences.set(draft.isEmpty ? text : draft + "\n\n" + text, for: key)
      if started {
        model.open(spawned: agentId, session: sessionId)
      } else {
        model.navigate(.session(id: sessionId, agentId: agentId))
      }
    }
  }

  /// The agent the session last showed if it's still going, else its newest live one.
  private static func liveAgent(in sessionId: String, model: DesktopModel) -> String? {
    let store = model.store
    let listed = model.session(sessionId).map { store.agentsByRepo[$0.repoRoot] ?? [] } ?? []
    let live =
      listed
      .filter { $0.sessionId == sessionId }
      .map { store.statusByAgent[$0.agentId] ?? $0 }
      .filter { $0.status != .stopped && $0.status != .error }
    if let last = model.lastAgents[sessionId], live.contains(where: { $0.agentId == last }) { return last }
    return live.max { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }?.agentId
  }

  /// `@path:12` or `@path:12-18`, the form chat links read back.
  static func mention(_ path: String, lines: ClosedRange<Int>) -> String {
    let escaped = path.replacingOccurrences(of: " ", with: "\\ ")
    return lines.count == 1 ? "@\(escaped):\(lines.lowerBound)" : "@\(escaped):\(lines.lowerBound)-\(lines.upperBound)"
  }

  private static func longestBacktickRun(in text: String) -> Int {
    var longest = 0
    var run = 0
    for character in text {
      run = character == "`" ? run + 1 : 0
      longest = max(longest, run)
    }
    return longest
  }
}
