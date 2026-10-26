import ArgusUI
import SwiftUI

/// The Mac transcript: newest at the bottom and pinned there while following,
/// older pages fetched on nearing the top without losing your place, TextKit
/// text you can select and search, file links, and the agent's pending
/// decisions at the foot. The list is an `NSTableView` of recycled rows
/// (`TranscriptTable`), so a long chat costs the rows on screen.
struct TranscriptView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.openInCode) private var openInCode

  let agentKey: String
  let sessionId: String
  /// Replaces the host's messages — the debug stress fixture renders through here.
  var fixture: [RemoteMessage]?
  /// "Nothing yet" over an empty chat; off where the pane draws its own.
  var showsEmptyState = true

  @State private var owner = TranscriptSessions.Owner()
  @State private var landed = false
  @State private var loadingOlder = false

  private var messages: [RemoteMessage] { fixture ?? host.visibleMessages(for: agentKey) }
  /// This agent's transcript, kept from the last time it was on screen.
  private var session: TranscriptSession {
    TranscriptSessions.shared.session(for: agentKey, owner: owner, store: host, sessionId: sessionId)
  }
  private var model: TranscriptModel { session.model }
  private var controller: TranscriptTableController { session.controller }
  private var links: TranscriptLinkHandler { session.links }
  private var hasQueue: Bool {
    !(host.queuedByAgent[agentKey] ?? []).isEmpty || !(host.failedByAgent[agentKey] ?? []).isEmpty
  }
  private var hasOlder: Bool { fixture == nil && host.hasOlderMessages(for: agentKey) }

  var body: some View {
    let messages = messages
    let pending = pendingCalls(messages)
    TranscriptTable(
      controller: controller, agentKey: agentKey, messages: messages,
      top: .init(hasOlder: hasOlder, loading: loadingOlder),
      footer: .init(pending: pending)
    )
    // Each agent has its own table; another agent's can't be updated into this one.
    .id(agentKey)
    .onChange(of: pending.map(\.id)) { _, ids in
      // A new decision always comes into view — it's what the agent waits on.
      if !ids.isEmpty { controller.jumpToLatest() }
    }
    .onChange(of: model.revealToken) { _, _ in reveal() }
    // Over the table, not in it: a row is as tall as its content, so only the pane can centre it.
    .overlay {
      if showsEmptyState && messages.isEmpty && (landed || fixture != nil) && !hasQueue {
        EmptyState(icon: Icon.agent, title: "Nothing yet", body: "Send this agent a message to get it going.")
          .allowsHitTesting(false)
      }
    }
    .overlay(alignment: .top) {
      if model.findOpen {
        TranscriptFindBar().padding(.top, 8)
      }
    }
    .overlay(alignment: .bottomTrailing) {
      JumpToLatest(follow: controller.follow) { controller.jumpToLatest() }
    }
    .background { shortcuts }
    .task(id: SearchKey(query: model.query, open: model.findOpen, count: messages.count, last: messages.last?.id)) {
      guard model.findOpen else { return }
      try? await Task.sleep(for: .milliseconds(80))
      guard !Task.isCancelled else { return }
      await model.search(messages)
    }
    .sheet(item: Bindable(model).messageAction) { action in
      switch action {
      case .edit(let message): EditMessageSheet(agentKey: agentKey, message: message)
      case .fork(let message): ForkMessageSheet(agentKey: agentKey, sessionId: sessionId, message: message)
      }
    }
    .environment(\.transcriptActionsEnabled, HostStore.parseStoppedKey(agentKey) == nil)
    .environment(model)
    .environment(\.transcriptLinks, links)
    .environment(\.toolTextRenderer, toolTextRenderer)
    .task(id: agentKey) {
      landed = false
      controller.onNeedOlder = { loadOlder() }
      await start()
    }
    #if DEBUG
      .task {
        if let fixture, TranscriptStress.count != nil {
          await TranscriptStress.run(model: model, messages: fixture)
        }
      }
    #endif
    .liveRefresh(enabled: fixture == nil && host.connection == .ready, every: .seconds(5)) {
      await host.refreshTranscript(agentId: agentKey)
    }
  }

  /// The next page of older history from the host; the table keeps the
  /// reader's place as it lands above them.
  private func loadOlder() {
    guard !loadingOlder, landed, hasOlder else { return }
    loadingOlder = true
    Task {
      await host.loadOlderMessages(agentId: agentKey)
      loadingOlder = false
    }
  }

  // MARK: Find

  private var shortcuts: some View {
    Group {
      Button("Find") { model.openFind() }
        .keyboardShortcut("f", modifiers: .command)
      Button("Find Next") { model.step(forward: true) }
        .keyboardShortcut("g", modifiers: .command)
        .disabled(!model.findOpen)
      Button("Find Previous") { model.step(forward: false) }
        .keyboardShortcut("g", modifiers: [.command, .shift])
        .disabled(!model.findOpen)
    }
    .opacity(0)
    .frame(width: 0, height: 0)
    .accessibilityHidden(true)
  }

  /// Scrolls the current match's row into view, opening its tool group first;
  /// the row's text view then brings the match's line on screen.
  private func reveal() {
    guard let hit = model.currentHit, let messageId = Self.messageId(of: hit.unitId) else { return }
    controller.reveal(messageId: messageId, openGroup: true)
  }

  private static func messageId(of unit: String) -> String? {
    if unit.hasPrefix("m:") { return String(unit.dropFirst(2)) }
    if unit.hasPrefix("t:") {
      let rest = unit.dropFirst(2)
      return rest.lastIndex(of: ":").map { String(rest[..<$0]) }
    }
    return nil
  }

  private struct SearchKey: Equatable {
    let query: String
    let open: Bool
    let count: Int
    let last: String?
  }

  // MARK: Helpers

  private func pendingCalls(_ messages: [RemoteMessage]) -> [RemoteToolCall] {
    // Decisions sit at the tail; there's no need to walk two thousand messages.
    messages.suffix(40).flatMap { message in
      message.toolCalls.filter { host.isToolCallPending(agentKey: agentKey, call: $0) }
    }
  }

  private var toolTextRenderer: ToolTextRenderer {
    ToolTextRenderer(
      render: { text, role in
        AnyView(TranscriptToolText(text: text, role: role))
      },
      openPath: { [links] path in links.openFile(FileLinks.parseFileRef(path)) })
  }

  private func start() async {
    links.openInCode = openInCode.map { open in { [sessionId] path, line in open(sessionId, path, line) } }
    // Saved chats link to files in the worktree too.
    Task { [links] in await links.load() }
    guard fixture == nil else { return }
    // A saved chat has no queue, subscription or anything left to catch up on.
    if HostStore.parseStoppedKey(agentKey) != nil {
      await host.loadTranscript(agentId: agentKey)
      landed = true
      return
    }
    await host.loadQueue(agentId: agentKey)
    // Events emitted before our subscription registered are lost; one
    // catch-up fetch closes that window.
    try? await Task.sleep(for: .milliseconds(600))
    await host.loadTranscript(agentId: agentKey)
    landed = true
  }
}

/// Whether the reader is following the tail. Written on every scroll, so only
/// the jump button observes it.
@MainActor
@Observable
final class FollowState {
  @ObservationIgnored var atBottom = true {
    didSet { if atBottom != oldValue { showJump = !atBottom } }
  }
  private(set) var showJump = false
}

private struct JumpToLatest: View {
  @Environment(\.theme) private var theme
  let follow: FollowState
  let action: () -> Void

  var body: some View {
    if follow.showJump {
      IconBtn(systemName: Icon.chevronDown, label: "Jump to latest", size: 13, action: action)
        .background(theme.bgSecondary, in: Circle())
        .overlay(Circle().stroke(theme.border, lineWidth: 1))
        .padding(16)
    }
  }
}

/// A tool's command or output as selectable, linkified monospaced text. Long
/// output shows its head until expanded, so a huge log costs 40 lines of layout.
struct TranscriptToolText: View {
  @Environment(TranscriptModel.self) private var model
  let text: String
  let role: ToolTextRenderer.Role

  private var expanded: Bool { model.expandedOutputs.contains(TranscriptModel.outputKey(text, role: role)) }

  private static let clipLines = 40
  private static let cache: NSCache<NSString, NSAttributedString> = {
    let cache = NSCache<NSString, NSAttributedString>()
    cache.countLimit = 400
    return cache
  }()

  var body: some View {
    let lines = text.utf8.count(where: { $0 == 10 }) + 1
    let clipped = !expanded && lines > Self.clipLines
    VStack(alignment: .leading, spacing: 4) {
      TranscriptText(text: rendered(clipped ? head : text))
      if lines > Self.clipLines {
        Button(expanded ? "Show less" : "Show all \(lines) lines") {
          let key = TranscriptModel.outputKey(text, role: role)
          if expanded { model.expandedOutputs.remove(key) } else { model.expandedOutputs.insert(key) }
        }
          .buttonStyle(.accentLink)
          .font(.scaled(size: 11))
      }
    }
  }

  private var head: String {
    text.split(separator: "\n", maxSplits: Self.clipLines, omittingEmptySubsequences: false)
      .prefix(Self.clipLines).joined(separator: "\n")
  }

  private func rendered(_ text: String) -> NSAttributedString {
    let key = "\(role)|\(TextScale.shared.factor)|\(text)" as NSString
    if let cached = Self.cache.object(forKey: key) { return cached }
    let color =
      switch role {
      case .error: TranscriptStyle.error
      case .command: TranscriptStyle.text
      case .output: TranscriptStyle.secondary
      }
    let rendered = TranscriptMarkdown.render(plain: text, color: color)
    Self.cache.setObject(rendered, forKey: key)
    return rendered
  }
}
