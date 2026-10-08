import ArgusCore
import ArgusEditor
import Foundation

/// One open file's language features: completion, hover and definition through the host's
/// language server. Each request goes out after the edits before it, and an answer the user
/// has typed past is dropped.
@MainActor
final class LspDocumentProvider: EditorLanguageProvider {
  let path: String
  let language: LspDocumentLanguage
  let sync: LspDocumentSync
  weak var document: EditorDocument?
  private weak var sink: LspSink?
  private var sessionId: String { sync.sessionId }

  init(path: String, language: LspDocumentLanguage, document: EditorDocument, sync: LspDocumentSync, sink: LspSink) {
    self.path = path
    self.language = language
    self.document = document
    self.sync = sync
    self.sink = sink
  }

  var completionTriggerCharacters: Set<Character> { language.triggerCharacters }

  func completions(at position: EditorPosition, trigger: Character?) async -> [EditorCompletionItem] {
    let params = ArgusProtocol.CommandsTypes.LspCompletionParams(
      id: sessionId, relativePath: path, position: LspConvert.position(position), triggerCharacter: trigger.map(String.init))
    guard let list = await current(ArgusProtocol.Commands.LspCompletion.self, params)
    else { return [] }
    return list.items.map(LspConvert.completionItem)
  }

  func resolve(_ item: EditorCompletionItem) async -> EditorCompletionItem {
    guard let resolveId = item.opaque as? String, let sink else { return item }
    do {
      let resolved = try await sink.send(
        ArgusProtocol.Commands.LspCompletionResolve.self,
        .init(id: sessionId, relativePath: path, resolveId: resolveId), session: sessionId)
      return LspConvert.merge(resolved, into: item)
    } catch {
      return item
    }
  }

  func hover(at position: EditorPosition) async -> EditorHover? {
    let params = ArgusProtocol.CommandsTypes.LspHoverParams(
      id: sessionId, relativePath: path, position: LspConvert.position(position))
    guard let hover = await current(ArgusProtocol.Commands.LspHover.self, params) else {
      return nil
    }
    return hover.flatMap(LspConvert.hover)
  }

  func definition(at position: EditorPosition) async -> [EditorLocation] {
    let params = ArgusProtocol.CommandsTypes.LspDefinitionParams(
      id: sessionId, relativePath: path, position: LspConvert.position(position))
    let locations = await current(ArgusProtocol.Commands.LspDefinition.self, params)
    return (locations ?? []).map(LspConvert.location)
  }

  /// Formats the whole buffer as one undo step, the caret kept in place. False when the server
  /// changed nothing, failed, or the text moved on meanwhile.
  func format() async -> Bool {
    guard let configuration = document?.configuration else { return false }
    let params = ArgusProtocol.CommandsTypes.LspFormatParams(
      id: sessionId, relativePath: path, tabSize: configuration.tabWidth, insertSpaces: configuration.insertSpaces)
    guard let edits = await current(ArgusProtocol.Commands.LspFormat.self, params), !edits.isEmpty, let document
    else { return false }
    document.apply(edits: edits.map { (LspConvert.range($0.range), $0.newText) }, moveCaret: false)
    return true
  }

  /// Sends `command` once the host has every edit so far; nil when it failed or the text moved on.
  private func current<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async -> C.Result? {
    // The position is in the text as of now.
    let version = document?.version
    await sync.flush()
    guard let sink, version != nil, document?.version == version else { return nil }
    do {
      let result = try await sink.send(command, params, session: sessionId)
      guard document?.version == version else { return nil }
      return result
    } catch {
      // A server that's missing or still starting answers with an error; the status bar says why.
      return nil
    }
  }
}
