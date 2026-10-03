import ArgusKit
import Foundation
import Observation

/// A session's terminals on the host: the tabs, which run commands are going,
/// and the byte streams views draw. PTYs live on the host, so this only ever
/// mirrors them — a window that closes and reopens finds them still running.
@MainActor
@Observable
public final class TerminalsStore {
  public struct Tab: Identifiable, Equatable, Sendable {
    public let id: String
    public let sessionId: String
    public var title: String
    /// The `.argus.json` run command this terminal runs, if it is one.
    public var runTitle: String?
    public var exitCode: Int?

    public var exited: Bool { exitCode != nil }
    public var isRun: Bool { runTitle != nil }
  }

  /// Run commands and auto-opened terminals, from a project's `.argus.json`.
  public struct ProjectConfig: Equatable, Sendable {
    public var run: [RunCommand] = []
    public var terminals: [(name: String, dir: String)] = []
    public var singleRuntime = false

    public static func == (a: Self, b: Self) -> Bool {
      a.run == b.run && a.singleRuntime == b.singleRuntime
        && a.terminals.map(\.name) == b.terminals.map(\.name)
        && a.terminals.map(\.dir) == b.terminals.map(\.dir)
    }
  }

  public struct RunCommand: Equatable, Sendable, Identifiable {
    public let title: String
    public let command: String
    public var id: String { title }
  }

  public struct Reveal: Equatable, Sendable {
    public let sessionId: String
    let nonce: Int
  }

  /// A run another session of the same project still has going, which a
  /// `single_runtime` project must stop first.
  public struct Conflict: Equatable, Sendable {
    public let sessionId: String
    public let terminalId: String
    public let title: String
  }

  /// What the host calls a session's setup PTY.
  public static let setupTitle = "Setup"

  public private(set) var tabsBySession: [String: [Tab]] = [:]
  public private(set) var activeBySession: [String: String] = [:]
  public private(set) var configByRepo: [String: ProjectConfig] = [:]
  /// Bumped when a run starts somewhere the user didn't press Run (an agent's
  /// `trigger_run`), so the window can bring the terminal panel up.
  public private(set) var revealed: Reveal?
  public private(set) var lastError: String?

  /// A view replayed a terminal's captured output: its size and whether the
  /// host had already dropped older output.
  @ObservationIgnored public var replayed: @MainActor (_ bytes: Int, _ truncated: Bool) -> Void = { _, _ in }

  @ObservationIgnored private let backend: @MainActor () -> (any HostBackend)?
  @ObservationIgnored private var subscribed: Set<String> = []
  @ObservationIgnored private var opened: Set<String> = []
  @ObservationIgnored private var feeds: [String: TerminalFeed] = [:]
  @ObservationIgnored private var sinks: [String: @MainActor (TerminalFeed.Output) -> Void] = [:]
  @ObservationIgnored private var revealNonce = 0

  public init(backend: @escaping @MainActor () -> (any HostBackend)?) {
    self.backend = backend
  }

  // MARK: Reading

  /// Run tabs first, pinned, as in the desktop app.
  public func tabs(_ sessionId: String) -> [Tab] {
    let tabs = tabsBySession[sessionId] ?? []
    return tabs.filter(\.isRun) + tabs.filter { !$0.isRun }
  }

  public func active(_ sessionId: String) -> Tab? {
    let tabs = tabs(sessionId)
    return tabs.first { $0.id == activeBySession[sessionId] } ?? tabs.first
  }

  /// The live terminal running `title` in this session, if any.
  public func running(_ title: String, in sessionId: String) -> Tab? {
    tabsBySession[sessionId]?.first { $0.runTitle == title && !$0.exited }
  }

  public var runningRuns: [Tab] {
    tabsBySession.values.joined().filter { $0.isRun && !$0.exited }
  }

  public func clearError() { lastError = nil }

  // MARK: Loading

  public func loadConfig(repoRoot: String) async {
    guard let backend = backend(),
      let config = try? await backend.request(
        ArgusProtocol.Commands.ReadArgusConfig.self, .init(repoRoot: repoRoot))
    else { return }
    let next = ProjectConfig(
      run: config.run.map { RunCommand(title: $0.title, command: $0.command) },
      terminals: config.terminals.map { ($0.name, $0.dir) },
      singleRuntime: config.singleRuntime ?? false)
    if configByRepo[repoRoot] != next { configByRepo[repoRoot] = next }
  }

  /// The host's live terminals for a session — they outlive any window.
  public func refresh(sessionId: String) async {
    guard let backend = backend(),
      let live = try? await backend.request(
        ArgusProtocol.Commands.ListTerminals.self, .init(sessionId: sessionId))
    else { return }
    var tabs = tabsBySession[sessionId] ?? []
    let liveIds = Set(live.map(\.id))
    // Gone from the host while we weren't looking (a restart, a reaper);
    // exited run tabs stay so their output can still be read.
    tabs.removeAll { !liveIds.contains($0.id) && !($0.isRun && $0.exited) }
    for terminal in live where !tabs.contains(where: { $0.id == terminal.id }) {
      tabs.append(
        Tab(
          id: terminal.id, sessionId: sessionId,
          title: terminal.title ?? terminal.runTitle ?? "Shell", runTitle: terminal.runTitle))
    }
    set(tabs, for: sessionId)
    for tab in tabs where !tab.exited { await subscribe(tab.id) }
  }

  /// The first time a session's terminals are shown: reattach to what's
  /// running, else open `.argus.json`'s terminals, else one shell.
  public func open(sessionId: String, repoRoot: String) async {
    await loadConfig(repoRoot: repoRoot)
    await refresh(sessionId: sessionId)
    guard !opened.contains(sessionId) else { return }
    opened.insert(sessionId)
    // The setup pipeline's PTY doesn't count: config terminals open beside it.
    guard !(tabsBySession[sessionId] ?? []).contains(where: { $0.title != Self.setupTitle }) else {
      return
    }
    for entry in configByRepo[repoRoot]?.terminals ?? [] {
      let title = entry.name.isEmpty ? (entry.dir.isEmpty ? "Shell" : entry.dir) : entry.name
      _ = await create(sessionId: sessionId, subDir: entry.dir.isEmpty ? nil : entry.dir, title: title)
    }
    if !(tabsBySession[sessionId] ?? []).contains(where: { $0.title != Self.setupTitle }) {
      _ = await create(sessionId: sessionId, subDir: nil, title: "Shell 1")
    }
  }

  // MARK: Actions

  @discardableResult
  public func newShell(sessionId: String) async -> Tab? {
    let count = (tabsBySession[sessionId] ?? []).filter { !$0.isRun && $0.title != Self.setupTitle }.count
    return await create(sessionId: sessionId, subDir: nil, title: "Shell \(count + 1)")
  }

  private func create(sessionId: String, subDir: String?, title: String) async -> Tab? {
    guard let backend = backend() else { return nil }
    do {
      let id = try await backend.request(
        ArgusProtocol.Commands.CreateTerminal.self,
        .init(sessionId: sessionId, subDir: subDir, title: title))
      let tab = Tab(id: id, sessionId: sessionId, title: title)
      set((tabsBySession[sessionId] ?? []) + [tab], for: sessionId)
      activeBySession[sessionId] = id
      await subscribe(id)
      return tab
    } catch {
      lastError = HostStore.describe(error)
      return nil
    }
  }

  /// Runs another session of the same project has going. Only sessions this
  /// app has loaded are known, as in the desktop app.
  public func conflicts(for sessionId: String, sessionsInRepo: Set<String>) -> [Conflict] {
    runningRuns
      .filter { $0.sessionId != sessionId && sessionsInRepo.contains($0.sessionId) }
      .map { Conflict(sessionId: $0.sessionId, terminalId: $0.id, title: $0.runTitle ?? $0.title) }
  }

  /// Start (or, with `restartOnRerun`, restart) one of the project's run
  /// commands. The host resolves the command from `.argus.json` itself.
  @discardableResult
  public func run(_ title: String, sessionId: String) async -> Tab? {
    guard let backend = backend() else { return nil }
    do {
      let result = try await backend.request(
        ArgusProtocol.Commands.CreateRunTerminal.self, .init(sessionId: sessionId, title: title))
      return await register(
        sessionId: sessionId, title: result.title, terminalId: result.sessionId,
        dependencies: result.dependencies.map { ($0.sessionId, $0.title) })
    } catch {
      lastError = HostStore.describe(error)
      return nil
    }
  }

  /// SIGINT, then harder; the tab flips to exited when the host says so.
  public func stop(_ terminalId: String) async {
    _ = try? await backend()?.request(
      ArgusProtocol.Commands.StopTerminal.self, .init(sessionId: terminalId))
  }

  /// Stop runs and wait for them to exit, so a replacement doesn't race them
  /// for a port. Gives up waiting after `timeout`.
  public func stopAndWait(_ terminalIds: [String], timeout: Duration = .seconds(8)) async {
    for id in terminalIds { await stop(id) }
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline, terminalIds.contains(where: { id in
      tabsBySession.values.joined().contains { $0.id == id && !$0.exited }
    }) {
      try? await Task.sleep(for: .milliseconds(100))
    }
  }

  /// Closing a tab kills its process, as in the desktop app.
  public func close(_ terminalId: String) async {
    guard let tab = tab(terminalId) else { return }
    remove(tab)
    _ = try? await backend()?.request(
      ArgusProtocol.Commands.DestroyTerminal.self, .init(sessionId: terminalId))
  }

  public func rename(_ terminalId: String, to title: String) async {
    let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, let tab = tab(terminalId) else { return }
    update(tab.sessionId, terminalId) { $0.title = title }
    _ = try? await backend()?.request(
      ArgusProtocol.Commands.UpdateTerminalTitle.self, .init(terminalId: terminalId, title: title))
  }

  public func select(_ terminalId: String, in sessionId: String) {
    activeBySession[sessionId] = terminalId
  }

  // MARK: I/O

  /// Draw a terminal: replay what it printed so far, then stream it live.
  /// Returns the detach.
  public func attach(
    _ terminalId: String, sink: @escaping @MainActor (TerminalFeed.Output) -> Void
  ) -> () -> Void {
    sinks[terminalId] = sink
    Task { await replay(terminalId) }
    return { [weak self] in
      MainActor.assumeIsolated {
        self?.sinks.removeValue(forKey: terminalId)
        self?.feeds.removeValue(forKey: terminalId)
      }
    }
  }

  private func replay(_ terminalId: String) async {
    guard let backend = backend() else { return }
    await subscribe(terminalId)
    var feed = TerminalFeed()
    feed.beginReplay()
    feeds[terminalId] = feed
    guard
      let (scrollback, seq) = try? await backend.sequencedRequest(
        ArgusProtocol.Commands.TerminalScrollback.self, .init(sessionId: terminalId)),
      sinks[terminalId] != nil
    else {
      feeds.removeValue(forKey: terminalId)
      return
    }
    let data = Data(base64Encoded: scrollback.data) ?? Data()
    let exitCode = scrollback.exited ? Int(scrollback.exitCode ?? -1) : nil
    replayed(data.count, scrollback.truncated)
    emit(terminalId, feeds[terminalId]?.replay(data: data, exitCode: exitCode, seq: seq) ?? [])
  }

  public func write(_ terminalId: String, _ bytes: Data) {
    guard let backend = backend() else { return }
    Task {
      _ = try? await backend.request(
        ArgusProtocol.Commands.TerminalWrite.self,
        .init(sessionId: terminalId, data: bytes.base64EncodedString()))
    }
  }

  public func resize(_ terminalId: String, cols: Int, rows: Int) {
    guard cols > 0, rows > 0, let backend = backend() else { return }
    Task {
      _ = try? await backend.request(
        ArgusProtocol.Commands.TerminalResize.self,
        .init(sessionId: terminalId, cols: Double(cols), rows: Double(rows)))
    }
  }

  // MARK: Events

  /// A raw host broadcast. True when it was a terminal's.
  @discardableResult
  public func ipc(channel: String, args: [JSONValue], seq: Int) -> Bool {
    if channel == "run:triggered" {
      runTriggered(args.first ?? .null)
      return true
    }
    let parts = channel.split(separator: ":", maxSplits: 2).map(String.init)
    guard parts.count == 3, parts[0] == "terminal" else { return false }
    let terminalId = parts[2]
    switch parts[1] {
    case "data":
      guard let base64 = args.first?.stringValue, let data = Data(base64Encoded: base64) else {
        return true
      }
      deliver(terminalId, .data(data), seq: seq)
    case "exit":
      let code = Int(args.first?.numberValue ?? -1)
      exited(terminalId, code: code)
      deliver(terminalId, .exit(code), seq: seq)
    default:
      return false
    }
    return true
  }

  /// The connection came back: the host forgot our subscriptions, and may
  /// have restarted with none of these terminals.
  public func reconnected() async {
    subscribed = []
    for sessionId in Array(tabsBySession.keys) { await refresh(sessionId: sessionId) }
    for terminalId in Array(sinks.keys) { await replay(terminalId) }
  }

  private func deliver(_ terminalId: String, _ event: TerminalFeed.Live, seq: Int) {
    guard sinks[terminalId] != nil, var feed = feeds[terminalId] else { return }
    let out = feed.live(event, seq: seq)
    feeds[terminalId] = feed
    emit(terminalId, out)
  }

  private func emit(_ terminalId: String, _ outputs: [TerminalFeed.Output]) {
    guard let sink = sinks[terminalId] else { return }
    for output in outputs { sink(output) }
  }

  private func exited(_ terminalId: String, code: Int) {
    guard let tab = tab(terminalId) else { return }
    subscribed.remove(terminalId)
    // A shell that exits closes its tab; a run's output stays readable.
    if tab.isRun {
      update(tab.sessionId, terminalId) { $0.exitCode = code }
    } else {
      remove(tab)
    }
  }

  private func runTriggered(_ payload: JSONValue) {
    struct Dependency: Decodable {
      let sessionId: String
      let title: String
    }
    struct Payload: Decodable {
      let sessionId: String
      let title: String
      let terminalSessionId: String
      let dependencies: [Dependency]
    }
    guard let run = try? ProtocolCodec.convert(payload, to: Payload.self) else { return }
    Task {
      await register(
        sessionId: run.sessionId, title: run.title, terminalId: run.terminalSessionId,
        dependencies: run.dependencies.map { ($0.sessionId, $0.title) })
      revealNonce += 1
      revealed = Reveal(sessionId: run.sessionId, nonce: revealNonce)
    }
  }

  @discardableResult
  private func register(
    sessionId: String, title: String, terminalId: String,
    dependencies: [(id: String, title: String)]
  ) async -> Tab? {
    var tabs = tabsBySession[sessionId] ?? []
    for (id, runTitle) in dependencies + [(terminalId, title)] {
      // A restarted run replaces its exited (or killed) predecessor.
      tabs.removeAll { $0.runTitle == runTitle && $0.id != id }
      if !tabs.contains(where: { $0.id == id }) {
        tabs.append(Tab(id: id, sessionId: sessionId, title: runTitle, runTitle: runTitle))
      }
    }
    set(tabs, for: sessionId)
    activeBySession[sessionId] = terminalId
    for (id, _) in dependencies { await subscribe(id) }
    await subscribe(terminalId)
    return tab(terminalId)
  }

  private func subscribe(_ terminalId: String) async {
    guard !subscribed.contains(terminalId), let backend = backend() else { return }
    subscribed.insert(terminalId)
    await backend.subscribe(agentId: "terminal:\(terminalId)", on: true)
  }

  // MARK: State

  private func tab(_ terminalId: String) -> Tab? {
    tabsBySession.values.joined().first { $0.id == terminalId }
  }

  private func set(_ tabs: [Tab], for sessionId: String) {
    if tabsBySession[sessionId] != tabs { tabsBySession[sessionId] = tabs }
  }

  private func update(_ sessionId: String, _ terminalId: String, _ change: (inout Tab) -> Void) {
    guard var tabs = tabsBySession[sessionId],
      let index = tabs.firstIndex(where: { $0.id == terminalId })
    else { return }
    change(&tabs[index])
    set(tabs, for: sessionId)
  }

  private func remove(_ tab: Tab) {
    set((tabsBySession[tab.sessionId] ?? []).filter { $0.id != tab.id }, for: tab.sessionId)
    if activeBySession[tab.sessionId] == tab.id { activeBySession[tab.sessionId] = nil }
    subscribed.remove(tab.id)
    sinks.removeValue(forKey: tab.id)
    feeds.removeValue(forKey: tab.id)
    if let backend = backend() {
      Task { await backend.subscribe(agentId: "terminal:\(tab.id)", on: false) }
    }
  }
}
