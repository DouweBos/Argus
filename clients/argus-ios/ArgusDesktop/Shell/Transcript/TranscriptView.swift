import ArgusUI
import SwiftUI

/// The Mac transcript: newest at the bottom and pinned there while following,
/// older pages loaded on reaching the top without losing your place, TextKit
/// text you can select and search, file links, and the agent's pending
/// decisions at the foot.
struct TranscriptView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let agentKey: String
  let sessionId: String
  /// Replaces the host's messages — the debug stress fixture renders through here.
  var fixture: [RemoteMessage]?

  @State private var model = TranscriptModel()
  @State private var links: TranscriptLinkHandler?
  @State private var viewer = ImageViewerState()
  @State private var atBottom = true
  @State private var landed = false
  @State private var loadingOlder = false

  private static let bottom = "transcript-bottom"

  private var messages: [RemoteMessage] { fixture ?? host.visibleMessages(for: agentKey) }

  var body: some View {
    let messages = messages
    let segments = ToolGroups.group(messages)
    let pending = pendingCalls(messages)
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 14) {
          topSentinel(first: segments.first?.id, proxy: proxy)
          if messages.isEmpty, landed || fixture != nil {
            EmptyState(
              icon: Icon.agent, title: "Nothing yet",
              body: "Send this agent a message to get it going.")
          }
          ForEach(segments) { segment in
            row(segment).id(segment.id)
          }
          footer(pending: pending)
          Color.clear.frame(height: 1).id(Self.bottom)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .frame(maxWidth: 920)
        .frame(maxWidth: .infinity)
      }
      .defaultScrollAnchor(.bottom)
      .onScrollGeometryChange(for: Bool.self) { geometry in
        geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 40
      } action: { _, isAtBottom in
        atBottom = isAtBottom
      }
      .onChange(of: tail(messages, pending: pending)) { _, _ in
        guard !messages.isEmpty else { return }
        if !landed {
          landed = true
          proxy.scrollTo(Self.bottom, anchor: .bottom)
          return
        }
        // Follow the tail only while the reader is at it; someone reading
        // history shouldn't be yanked down by new output.
        guard atBottom else { return }
        proxy.scrollTo(Self.bottom, anchor: .bottom)
      }
      .onChange(of: pending.map(\.id)) { _, ids in
        // A new decision always comes into view — it's what the agent waits on.
        if !ids.isEmpty { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(Self.bottom, anchor: .bottom) } }
      }
      .onChange(of: model.revealToken) { _, _ in
        reveal(segments: segments, proxy: proxy)
      }
      .overlay(alignment: .top) {
        if model.findOpen {
          TranscriptFindBar().padding(.top, 8)
        }
      }
      .overlay(alignment: .bottomTrailing) {
        if !atBottom {
          IconBtn(systemName: Icon.chevronDown, label: "Jump to latest", size: 13) {
            withAnimation { proxy.scrollTo(Self.bottom, anchor: .bottom) }
          }
          .background(theme.bgSecondary, in: Circle())
          .overlay(Circle().stroke(theme.border, lineWidth: 1))
          .padding(16)
        }
      }
    }
    .background { shortcuts }
    .task(id: SearchKey(query: model.query, open: model.findOpen, count: messages.count, last: messages.last?.id)) {
      guard model.findOpen else { return }
      try? await Task.sleep(for: .milliseconds(80))
      guard !Task.isCancelled else { return }
      model.search(messages)
    }
    .overlay { ImageViewerOverlay() }
    .environment(model)
    .environment(viewer)
    .environment(\.transcriptLinks, links)
    .environment(\.toolTextRenderer, toolTextRenderer)
    .task(id: agentKey) { await start() }
    #if DEBUG
      .task {
        if let fixture { await TranscriptStress.run(model: model, messages: fixture) }
      }
    #endif
    .liveRefresh(enabled: fixture == nil && host.connection == .ready, every: .seconds(5)) {
      await host.loadTranscript(agentId: agentKey)
    }
  }

  // MARK: Rows

  @ViewBuilder
  private func row(_ segment: ToolGroups.Segment) -> some View {
    switch segment {
    case .single(let message):
      TranscriptMessageRow(agentKey: agentKey, message: message)
    case .collapsed(let messages):
      TranscriptToolGroup(agentKey: agentKey, id: segment.id, messages: messages)
    }
  }

  @ViewBuilder
  private func footer(pending: [RemoteToolCall]) -> some View {
    WorkingIndicator(
      status: host.statusByAgent[agentKey]?.status,
      pendingToolName: host.pendingToolByAgent[agentKey],
      pendingToolInput: nil,
      hasPendingPermission: !pending.isEmpty)

    if let tasks = host.tasksByAgent[agentKey], !tasks.isEmpty {
      TaskListView(
        title: "Tasks", items: tasks.map { ($0.activeForm ?? $0.subject, $0.status, $0.owner) })
    }
    if let todos = host.todosByAgent[agentKey], !todos.isEmpty {
      TaskListView(title: "Todos", items: todos.map { ($0.activeForm ?? $0.content, $0.status, nil) })
    }

    TranscriptPrompts(agentKey: agentKey, pending: pending)

    let queued = host.queuedByAgent[agentKey] ?? []
    if !queued.isEmpty {
      SectionHeader(title: "Queued", count: queued.count)
      ForEach(queued) { QueuedMessageCard(agentKey: agentKey, message: $0) }
    }
    let failed = host.failedByAgent[agentKey] ?? []
    if !failed.isEmpty {
      SectionHeader(title: "Not sent", count: failed.count)
      ForEach(failed) { FailedSendCard(agentKey: agentKey, item: $0) }
    }
  }

  /// Reaching this means the reader wants older history. Once the page lands,
  /// the row that was first goes back to the top, so the view doesn't jump.
  @ViewBuilder
  private func topSentinel(first: String?, proxy: ScrollViewProxy) -> some View {
    if fixture == nil, host.hasOlderMessages(for: agentKey) {
      HStack(spacing: 8) {
        Spacer()
        if loadingOlder {
          ProgressView().controlSize(.small)
          MutedText("Loading earlier messages…")
        }
        Spacer()
      }
      .frame(height: 28)
      .onAppear {
        guard !loadingOlder, landed else { return }
        loadingOlder = true
        Task {
          await host.loadOlderMessages(agentId: agentKey)
          if let first { proxy.scrollTo(first, anchor: .top) }
          loadingOlder = false
        }
      }
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

  /// Scrolls the current match's row into view, opening its tool group first.
  private func reveal(segments: [ToolGroups.Segment], proxy: ScrollViewProxy) {
    guard let hit = model.currentHit, let messageId = Self.messageId(of: hit.unitId) else { return }
    for segment in segments {
      switch segment {
      case .single(let message) where message.id == messageId:
        withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(segment.id, anchor: .center) }
        return
      case .collapsed(let group) where group.contains { $0.id == messageId }:
        model.expandedGroups.insert(segment.id)
        DispatchQueue.main.async {
          withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(segment.id, anchor: .top) }
        }
        return
      default:
        continue
      }
    }
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

  /// Changes whenever something lands at the bottom: a message, more text in
  /// the last one, a decision, or a queued send.
  private func tail(_ messages: [RemoteMessage], pending: [RemoteToolCall]) -> [Int] {
    let last = messages.last
    return [
      messages.count,
      last?.textBlocks.reduce(0) { $0 + $1.utf16.count } ?? 0,
      last?.toolCalls.count ?? 0,
      last?.toolCalls.last?.resultBlocks.count ?? 0,
      pending.count,
      host.queuedByAgent[agentKey]?.count ?? 0,
      host.failedByAgent[agentKey]?.count ?? 0,
    ]
  }

  private var toolTextRenderer: ToolTextRenderer {
    ToolTextRenderer(
      render: { text, role in
        AnyView(TranscriptToolText(text: text, role: role))
      },
      openPath: { [links] path in links?.openFile(FileLinks.parseFileRef(path)) })
  }

  private func start() async {
    if links == nil {
      links = TranscriptLinkHandler(store: host, sessionId: sessionId)
    }
    guard fixture == nil else { return }
    await host.loadQueue(agentId: agentKey)
    await links?.load()
    // Events emitted before our subscription registered are lost; one
    // catch-up fetch closes that window.
    try? await Task.sleep(for: .milliseconds(600))
    await host.loadTranscript(agentId: agentKey)
    if !landed, messages.isEmpty { landed = true }
  }
}

/// A tool's command or output as selectable, linkified monospaced text. Long
/// output shows its head until expanded, so a huge log costs 40 lines of layout.
struct TranscriptToolText: View {
  let text: String
  let role: ToolTextRenderer.Role

  @State private var expanded = false

  private static let clipLines = 40
  private static let cache = NSCache<NSString, NSAttributedString>()

  var body: some View {
    let lines = text.utf8.count(where: { $0 == 10 }) + 1
    let clipped = !expanded && lines > Self.clipLines
    VStack(alignment: .leading, spacing: 4) {
      TranscriptText(text: rendered(clipped ? head : text))
      if lines > Self.clipLines {
        Button(expanded ? "Show less" : "Show all \(lines) lines") { expanded.toggle() }
          .buttonStyle(.link)
          .font(.system(size: 11))
      }
    }
  }

  private var head: String {
    text.split(separator: "\n", maxSplits: Self.clipLines, omittingEmptySubsequences: false)
      .prefix(Self.clipLines).joined(separator: "\n")
  }

  private func rendered(_ text: String) -> NSAttributedString {
    let key = "\(role)|\(text)" as NSString
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
