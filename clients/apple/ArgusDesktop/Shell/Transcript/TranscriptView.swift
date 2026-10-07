import ArgusUI
import SwiftUI

/// The Mac transcript: newest at the bottom and pinned there while following,
/// older rows revealed (or fetched) on reaching the top without losing your
/// place, TextKit text you can select and search, file links, and the agent's
/// pending decisions at the foot. Only the window's rows exist, so a long chat
/// costs a page of rows on a resize, not all of them.
struct TranscriptView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let agentKey: String
  let sessionId: String
  /// Replaces the host's messages — the debug stress fixture renders through here.
  var fixture: [RemoteMessage]?

  @State private var model = TranscriptModel()
  @State private var links: TranscriptLinkHandler?
  /// Whether the reader is following the tail. Written on every scroll, so it
  /// is observed only by the jump button — the transcript itself re-rendering
  /// on each flip feeds back into the lazy stack's layout.
  @State private var follow = FollowState()
  @State private var landed = false
  @State private var loadingOlder = false
  @State private var window = TranscriptWindow()

  private static let bottom = "transcript-bottom"

  private var messages: [RemoteMessage] { fixture ?? host.visibleMessages(for: agentKey) }

  var body: some View {
    let messages = messages
    let segments = ToolGroups.group(messages)
    let windowStart = window.start(segments)
    let shown = segments[windowStart...]
    let pending = pendingCalls(messages)
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 14) {
          topSentinel(first: shown.first?.id, hidden: windowStart > 0, segments: segments, proxy: proxy)
          if messages.isEmpty, landed || fixture != nil {
            EmptyState(
              icon: Icon.agent, title: "Nothing yet",
              body: "Send this agent a message to get it going.")
          }
          ForEach(shown) { segment in
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
      .defaultScrollAnchor(.bottom, for: .initialOffset)
      // Rows re-measure at a new width and the lazy stack's estimates move the
      // offset; someone following the tail stays on it through a resize.
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { _ in
        guard follow.atBottom else { return }
        window.trim(segments)
        proxy.scrollTo(Self.bottom, anchor: .bottom)
      }
      .onScrollGeometryChange(for: ScrollState.self) { geometry in
        ScrollState(
          offset: geometry.contentOffset.y, content: geometry.contentSize.height,
          container: geometry.containerSize.height)
      } action: { _, new in
        // Only the reader's own scrolling says where they want to be. The
        // lazy stack shifts the offset as it re-measures rows, and new output
        // grows the content; neither should end following.
        if follow.userScrolling { follow.atBottom = new.isAtBottom }
        // The sentinel's `onAppear` misses a top it never left; reaching it does not.
        if new.offset < 80, new.content > new.container {
          loadOlder(first: shown.first?.id, hidden: windowStart > 0, segments: segments, proxy: proxy)
        }
      }
      .onScrollPhaseChange { _, phase, context in
        let wasUser = follow.userScrolling
        follow.userScrolling = phase == .interacting || phase == .decelerating || phase == .tracking
        // Settling after our own `scrollTo` while rows are still measuring
        // says nothing about where the reader wants to be.
        if phase == .idle, wasUser {
          let geometry = context.geometry
          follow.atBottom =
            geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 40
        }
      }
      .onChange(of: tail(messages, pending: pending), initial: true) { _, _ in
        guard !messages.isEmpty else { return }
        if !landed {
          landed = true
          // Pinned from here on, so output arriving below never slides the
          // window out from under someone reading near its top.
          if window.pinned == nil { window.pinned = shown.first?.firstMessageId }
          proxy.scrollTo(Self.bottom, anchor: .bottom)
          return
        }
        // Follow the tail only while the reader is at it; someone reading
        // history shouldn't be yanked down by new output.
        guard follow.atBottom else { return }
        window.trim(segments)
        proxy.scrollTo(Self.bottom, anchor: .bottom)
      }
      .onChange(of: pending.map(\.id)) { _, ids in
        // A new decision always comes into view — it's what the agent waits on.
        // Again once the card has laid out: the lazy stack measures it late, and
        // the first scroll stops short of a form taller than its estimate.
        guard !ids.isEmpty else { return }
        follow.atBottom = true
        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(Self.bottom, anchor: .bottom) }
        Task { @MainActor in
          try? await Task.sleep(for: .milliseconds(250))
          withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(Self.bottom, anchor: .bottom) }
        }
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
        JumpToLatest(follow: follow) {
          follow.atBottom = true
          window.trim(segments, limit: TranscriptWindow.page)
          withAnimation { proxy.scrollTo(Self.bottom, anchor: .bottom) }
        }
      }
    }
    .background { shortcuts }
    .task(id: SearchKey(query: model.query, open: model.findOpen, count: messages.count, last: messages.last?.id)) {
      guard model.findOpen else { return }
      try? await Task.sleep(for: .milliseconds(80))
      guard !Task.isCancelled else { return }
      await model.search(messages)
    }
    .environment(model)
    .environment(\.transcriptLinks, links)
    .environment(\.toolTextRenderer, toolTextRenderer)
    .task(id: agentKey) { await start() }
    .onChange(of: agentKey) { window = TranscriptWindow() }
    #if DEBUG
      .task {
        if let fixture, TranscriptStress.count != nil {
          await TranscriptStress.run(model: model, messages: fixture)
        }
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
      TranscriptMessageRow(agentKey: agentKey, message: message).equatable()
    case .collapsed(let messages):
      TranscriptToolGroup(agentKey: agentKey, id: segment.id, messages: messages).equatable()
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

  /// Reaching this means the reader wants older history: the next page above
  /// the window, or once none is left here, the host's. Once it lands the row
  /// that was first goes back to the top, so the view doesn't jump.
  @ViewBuilder
  private func topSentinel(
    first: String?, hidden: Bool, segments: [ToolGroups.Segment], proxy: ScrollViewProxy
  ) -> some View {
    if hidden || (fixture == nil && host.hasOlderMessages(for: agentKey)) {
      HStack(spacing: 8) {
        Spacer()
        if loadingOlder {
          ProgressView().controlSize(.small)
          MutedText("Loading earlier messages…")
        }
        Spacer()
      }
      .frame(height: 28)
      .onAppear { loadOlder(first: first, hidden: hidden, segments: segments, proxy: proxy) }
    }
  }

  private func loadOlder(first: String?, hidden: Bool, segments: [ToolGroups.Segment], proxy: ScrollViewProxy) {
    guard !loadingOlder, landed, hidden || (fixture == nil && host.hasOlderMessages(for: agentKey)) else { return }
    loadingOlder = true
    Task {
      if hidden {
        window.grow(segments)
      } else {
        await host.loadOlderMessages(agentId: agentKey)
        window.pinned = host.visibleMessages(for: agentKey).first?.id
      }
      if let first { scroll(to: first, anchor: .top, proxy: proxy) }
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

  /// Scrolls the current match's row into view, rendering it and opening its
  /// tool group first.
  private func reveal(segments: [ToolGroups.Segment], proxy: ScrollViewProxy) {
    guard let hit = model.currentHit, let messageId = Self.messageId(of: hit.unitId),
      let segment = segments.first(where: { $0.holds(messageId) })
    else { return }
    window.include(messageId, in: segments)
    if case .collapsed = segment {
      model.expandedGroups.insert(segment.id)
      scroll(to: segment.id, anchor: .top, proxy: proxy)
    } else {
      scroll(to: segment.id, anchor: .center, proxy: proxy)
    }
  }

  /// A row revealed by this same change only exists after the next pass.
  private func scroll(to id: String, anchor: UnitPoint, proxy: ScrollViewProxy) {
    proxy.scrollTo(id, anchor: anchor)
    DispatchQueue.main.async { proxy.scrollTo(id, anchor: anchor) }
  }

  private static func messageId(of unit: String) -> String? {
    if unit.hasPrefix("m:") { return String(unit.dropFirst(2)) }
    if unit.hasPrefix("t:") {
      let rest = unit.dropFirst(2)
      return rest.lastIndex(of: ":").map { String(rest[..<$0]) }
    }
    return nil
  }

  private struct ScrollState: Equatable {
    let offset: CGFloat
    let content: CGFloat
    let container: CGFloat

    var isAtBottom: Bool { offset + container >= content - 40 }
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

@MainActor
@Observable
final class FollowState {
  @ObservationIgnored var atBottom = true {
    didSet { if atBottom != oldValue { showJump = !atBottom } }
  }
  @ObservationIgnored var userScrolling = false
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
