import ArgusCore
import ArgusEditor
import ArgusSyntax
import Foundation

/// Reading, saving and following files on disk: `code_read_file`,
/// `code_write_file` with the hash it was read at, `code_watch_files`.
extension CodeSession {
  /// Makes the tab's buffer and starts reading it.
  func open(_ path: String, source: MacTelemetryEvent.EditorOpenSource) -> CodeFile {
    let file = CodeFile(path: path)
    files[path] = file
    Task { await load(file, source: source) }
    return file
  }

  private func load(_ file: CodeFile, source: MacTelemetryEvent.EditorOpenSource) async {
    guard let store else { return }
    do {
      let read = try await store.request(
        ArgusProtocol.Commands.CodeReadFile.self, .init(id: sessionId, relativePath: file.path), session: sessionId)
      guard files[file.path] === file else { return }
      let firstLine = read.content.prefix { $0 != "\n" }
      let language = SyntaxLanguage.detect(path: file.path, firstLine: String(firstLine.prefix(200)))
      file.language = language
      file.eol = read.eol
      MacTelemetry.capture(
        .editorFileOpened(
          source: source, language: MacTelemetryEvent.languageName(language),
          sizeBucket: MacTelemetryEvent.fileSizeBucket(read.size), readOnly: read.readOnlyReason != nil))
      if let reason = read.readOnlyReason {
        file.phase = .readOnly(reason)
        return
      }
      file.editorConfig = await editorConfigs.properties(for: file.path)
      let document = EditorDocument(
        text: read.content, language: language,
        configuration: AppPreferences.shared.editorSettings.configuration(applying: file.editorConfig))
      document.relativePath = file.path
      let actions = CodeEditorActions(session: self, path: file.path)
      file.actions = actions
      document.actions = actions
      CodeShortcuts.install(on: document, store: store)
      document.onTextChange = { [weak self, weak file] change in
        guard let self, let file else { return }
        self.textChanged(file, change)
      }
      file.disk = CodeDiskState(baseHash: read.hash)
      file.phase = .ready(document)
      reportHighlighting(document, language: language)
      if let line = file.pendingLine {
        file.pendingLine = nil
        document.reveal(line: line)
      }
      store.languageSupport?.documentOpened(
        session: sessionId, path: file.path, document: document, language: language)
      Task { await detectFormatter(file) }
      await watch(file.path)
      await refreshGitBase(file)
    } catch {
      file.phase = .failed(HostStore.describe(error))
    }
  }

  private func reportHighlighting(_ document: EditorDocument, language: SyntaxLanguage?) {
    let reason: String
    switch document.highlightStatus {
    case .highlighted: return
    case .plainText: reason = "no_grammar"
    case .disabled(let disabled): reason = disabled.rawValue
    }
    MacTelemetry.capture(
      .editorHighlightUnavailable(language: MacTelemetryEvent.languageName(language), reason: reason))
  }

  private func textChanged(_ file: CodeFile, _ change: EditorTextChange) {
    if !change.isFullReplace, tabs.previewPath == file.path { pin(file.path) }
    scheduleGutter(file)
    store?.languageSupport?.documentChanged(session: sessionId, path: file.path, change: change)
  }

  /// A file's text, or nil when it doesn't exist or can't be edited here.
  func readText(_ path: String) async -> String? {
    guard let store,
      let read = try? await store.request(
        ArgusProtocol.Commands.CodeReadFile.self, .init(id: sessionId, relativePath: path), session: sessionId),
      read.readOnlyReason == nil
    else { return nil }
    return read.content
  }

  // MARK: Saving

  /// ⌘S. False when it didn't land: a conflict (the banner says so) or an error.
  @discardableResult
  func save(_ path: String) async -> Bool {
    guard let store, let file = files[path], let document = file.document, !file.isSaving else { return false }
    file.isSaving = true
    defer { file.isSaving = false }
    // Formatting must never cost the save: past the limit, write the text as it is.
    let format = await Self.bounded(Self.formatOnSaveLimit, fallback: CodeFormatOutcome()) {
      await self.format(path, trigger: .save)
    }
    let text = document.textForSaving()
    let version = document.version
    let request = file.disk.saveRequest
    let hadConflict = file.disk.hadConflict
    do {
      let result = try await store.request(
        ArgusProtocol.Commands.CodeWriteFile.self,
        .init(
          id: sessionId, relativePath: path, content: text, baseHash: request.baseHash,
          force: request.force ? true : nil),
        session: sessionId)
      guard result.ok, let hash = result.hash else {
        file.disk.saveConflicted(diskHash: result.conflict?.hash)
        return false
      }
      // Typing during the write leaves the buffer dirty against what landed.
      if document.version == version { document.markSaved() }
      file.disk.saved(hash: hash)
      tabs.open(path, preview: false)
      MacTelemetry.capture(
        .editorFileSaved(formatted: format.changed, formatter: format.formatter, hadConflict: hadConflict))
      store.languageSupport?.documentSaved(session: sessionId, path: path, document: document)
      if file.name == ".editorconfig" {
        editorConfigs.invalidate()
        await reapplyEditorConfig()
      }
      scheduleGutter(file)
      return true
    } catch {
      store.host.report(error, scope: "code.save")
      return false
    }
  }

  /// A bit over the host's own 5s formatter limit, so its answer wins when it gives one.
  static let formatOnSaveLimit: Duration = .seconds(7)

  /// `operation`'s result, or `fallback` once `limit` passes; a late result is dropped and
  /// the operation's task cancelled, so it can tell it was too late.
  static func bounded<T: Sendable>(_ limit: Duration, fallback: T, _ operation: @escaping @MainActor () async -> T) async -> T {
    let once = BoundedOnce()
    return await withCheckedContinuation { continuation in
      let work = Task { @MainActor in
        let value = await operation()
        guard !once.done else { return }
        once.done = true
        continuation.resume(returning: value)
      }
      Task { @MainActor in
        try? await Task.sleep(for: limit)
        guard !once.done else { return }
        once.done = true
        work.cancel()
        continuation.resume(returning: fallback)
      }
    }
  }

  /// ⌥⌘S, and before quitting.
  func saveAll() async -> Bool {
    var ok = true
    for file in files.values where file.isDirty {
      if await !save(file.path) { ok = false }
    }
    return ok
  }

  // MARK: Disk changes

  func fileChanged(_ change: ArgusProtocol.CodeFileChanged) {
    guard let file = files[change.relativePath], let document = file.document else { return }
    switch file.disk.diskChanged(hash: change.hash, isDirty: document.isDirty) {
    case .reload: Task { await reloadFromDisk(file, external: true) }
    case .showBanner, .markDeleted, .none: break
    }
  }

  /// Takes the disk's text into the buffer as one undo step, flashing what changed.
  func reloadFromDisk(_ file: CodeFile, external: Bool) async {
    guard let store, let document = file.document else { return }
    do {
      let read = try await store.request(
        ArgusProtocol.Commands.CodeReadFile.self, .init(id: sessionId, relativePath: file.path), session: sessionId)
      if let reason = read.readOnlyReason {
        file.phase = .readOnly(reason)
        return
      }
      document.reload(from: read.content, flashChanges: true)
      file.disk.loaded(hash: read.hash)
      file.eol = read.eol
      scheduleGutter(file)
      if external, !file.reportedExternalReload {
        file.reportedExternalReload = true
        MacTelemetry.capture(.editorExternalReload(agentRunning: agentRunning))
      }
    } catch {
      store.host.report(error, scope: "code.reload")
    }
  }

  /// The banner's Reload: drop my edits for the disk's (⌘Z brings them back).
  func resolveWithReload(_ path: String) async {
    guard let file = files[path] else { return }
    MacTelemetry.capture(.editorConflictResolved(action: .reload))
    file.comparison = nil
    await reloadFromDisk(file, external: false)
  }

  func resolveKeepingMine(_ path: String) {
    guard let file = files[path] else { return }
    MacTelemetry.capture(.editorConflictResolved(action: .keepMine))
    file.comparison = nil
    file.disk.keepMine()
  }

  /// The banner's Compare: the disk's text against the buffer.
  func compare(_ path: String) async {
    guard let file = files[path], let document = file.document else { return }
    MacTelemetry.capture(.editorConflictResolved(action: .compare))
    file.comparison = CodeHunks(base: await readText(path) ?? "", current: document.text)
  }

  private var agentRunning: Bool {
    guard let host = store?.host else { return false }
    return host.statusByAgent.values.contains { $0.sessionId == sessionId && $0.status == .running }
  }

  // MARK: Watching

  private func watch(_ path: String) async {
    guard let store, !watched.contains(path) else { return }
    if !subscribed {
      subscribed = true
      await store.subscribe("code:\(sessionId)", session: sessionId, on: true)
    }
    watched.insert(path)
    _ = try? await store.request(
      ArgusProtocol.Commands.CodeWatchFiles.self, .init(id: sessionId, paths: [path]), session: sessionId)
  }

  /// A new connection: subscribe and watch again, and catch up on what changed meanwhile.
  func reconnected() async {
    guard let store, subscribed else { return }
    await store.subscribe("code:\(sessionId)", session: sessionId, on: true)
    let paths = Array(watched)
    if !paths.isEmpty {
      _ = try? await store.request(
        ArgusProtocol.Commands.CodeWatchFiles.self, .init(id: sessionId, paths: paths), session: sessionId)
    }
    for file in files.values where file.document != nil {
      guard
        let read = try? await store.request(
          ArgusProtocol.Commands.CodeReadFile.self, .init(id: sessionId, relativePath: file.path),
          session: sessionId)
      else { continue }
      fileChanged(.init(relativePath: file.path, hash: read.hash, mtimeMs: read.mtimeMs))
    }
  }

  // MARK: Settings

  func applySettings() {
    let settings = AppPreferences.shared.editorSettings
    for file in files.values {
      file.document?.configuration = settings.configuration(applying: file.editorConfig)
    }
  }

  private func reapplyEditorConfig() async {
    for file in files.values {
      file.editorConfig = await editorConfigs.properties(for: file.path)
    }
    applySettings()
  }
}

/// Whichever of `bounded`'s work and timer finishes first; both run on the main actor.
@MainActor private final class BoundedOnce {
  var done = false
}
